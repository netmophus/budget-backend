/**
 * BudgetImportService (Lot 3.7) — import en masse de saisie
 * budgétaire depuis un fichier CSV ou XLSX.
 *
 * Pipeline (algorithme) :
 *  1. Validation contexte : version statut='ouvert', user a
 *     BUDGET.SAISIR (vérifié par le PermissionsGuard côté controller).
 *  2. Détection format : extension `.csv` → csv-parse synchrone,
 *     `.xlsx` → exceljs ; rejet sinon.
 *  3. Lecture en mémoire (limite 10 MB côté multer / controller) +
 *     validation header (9 colonnes obligatoires dans l'ordre figé).
 *  4. Pour chaque ligne :
 *     - validation Zod du format,
 *     - résolution des FK par codes business (CR, compte, ligne_metier,
 *       temps),
 *     - vérification périmètre (`PerimetreService.getCrAutorisesPourUser`),
 *     - vérification compte feuille (est_compte_collectif=false),
 *     - cohérence mode_saisie + montant (recalcul ENCOURS_TIE → warning),
 *     - constitution d'une liste d'opérations à exécuter.
 *  5. Si > 10 % d'erreurs (`erreurs.length / lignesTotal > 0.10`) :
 *     `transactionRollback=true`, AUCUNE écriture DB. Le rapport est
 *     retourné tel quel.
 *  6. Sinon, transaction unique : INSERT ON CONFLICT … DO UPDATE pour
 *     chaque opération valide, audit `IMPORT_BUDGET_BULK` consigné
 *     avec le rapport en `payloadApres`.
 *
 * Contrainte unique côté DB : `uq_fait_budget_grain` (10 FK). On
 * cible l'upsert sur (`fk_temps, fk_compte, fk_structure, fk_centre,
 * fk_ligne_metier, fk_produit, fk_segment, fk_devise, fk_version,
 * fk_scenario`).
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { parse as parseCsv } from 'csv-parse/sync';
import ExcelJS from 'exceljs';
import { DataSource, EntityManager } from 'typeorm';
import { z } from 'zod';

import { AuditService } from '../../audit/audit.service';
import { PermissionsService } from '../../auth/permissions.service';
import {
  ImportBudgetErrorCode,
  ImportBudgetErrorDto,
  ImportBudgetRapportDto,
  ImportBudgetWarningDto,
} from '../dto/import-budget.dto';
import { PerimetreService } from './perimetre.service';

const HEADER_ORDONNE = [
  'code_cr',
  'code_compte',
  'code_ligne_metier',
  'mois',
  'mode_saisie',
  'montant',
  'encours_moyen',
  'tie',
  'commentaire',
] as const;

type RowBrute = Record<string, string>;

const ligneSchema = z
  .object({
    code_cr: z.string().min(1, 'Obligatoire'),
    code_compte: z.string().min(1, 'Obligatoire'),
    code_ligne_metier: z.string().min(1, 'Obligatoire'),
    mois: z
      .string()
      .regex(/^\d{4}-\d{2}(-\d{2})?$/, 'Format attendu YYYY-MM ou YYYY-MM-DD'),
    mode_saisie: z.enum(['MONTANT', 'ENCOURS_TIE']),
    montant: z
      .string()
      .optional()
      .transform((v) => (v === undefined || v === '' ? null : v)),
    encours_moyen: z
      .string()
      .optional()
      .transform((v) => (v === undefined || v === '' ? null : v)),
    tie: z
      .string()
      .optional()
      .transform((v) => (v === undefined || v === '' ? null : v)),
    commentaire: z
      .string()
      .optional()
      .transform((v) => (v === undefined || v === '' ? null : v)),
  })
  .refine(
    (d) =>
      d.mode_saisie === 'MONTANT'
        ? d.montant !== null
        : d.encours_moyen !== null && d.tie !== null,
    {
      message:
        'mode=MONTANT exige `montant` ; mode=ENCOURS_TIE exige `encours_moyen` ET `tie`',
    },
  );

type LigneValidee = z.infer<typeof ligneSchema>;

interface OperationUpsert {
  ligneNumero: number;
  fkTemps: string;
  fkCompte: string;
  fkCentre: string;
  fkStructure: string;
  fkLigneMetier: string;
  fkProduit: string;
  fkSegment: string;
  fkDevise: string;
  modeSaisie: 'MONTANT' | 'ENCOURS_TIE';
  montant: number;
  encoursMoyen: number | null;
  tie: number | null;
  commentaire: string | null;
}

const TAUX_ERREURS_ROLLBACK = 0.1; // > 10 % → rollback global

@Injectable()
export class BudgetImportService {
  private readonly logger = new Logger(BudgetImportService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly perimetreService: PerimetreService,
    private readonly auditService: AuditService,
    private readonly permissionsService: PermissionsService,
  ) {}

  // ─── Point d'entrée public ───────────────────────────────────────

  async importFichier(
    file: { buffer: Buffer; originalname: string; size: number },
    versionId: string,
    scenarioId: string,
    user: { userId: string; email: string },
  ): Promise<ImportBudgetRapportDto> {
    const start = Date.now();

    // 1. Détection format
    const formatDetecte = this.detecterFormat(file.originalname);

    // 2. Validation contexte version
    await this.assertVersionOuverte(versionId);

    // 3. Parsing → liste de rows brutes
    const rowsBrutes = await this.parserFichier(file.buffer, formatDetecte);

    // 4. Validation header (1ère ligne déjà consommée par le parser
    //    qui a converti les colonnes en clés). On vérifie que toutes
    //    les colonnes attendues sont présentes.
    if (rowsBrutes.length === 0) {
      throw new BadRequestException(
        'Fichier vide ou aucune ligne de données après le header.',
      );
    }
    const colonnesPresentes = Object.keys(rowsBrutes[0]!);
    const manquantes = HEADER_ORDONNE.filter(
      (c) => !colonnesPresentes.includes(c),
    );
    if (manquantes.length > 0) {
      throw new BadRequestException(
        `Header invalide. Colonnes manquantes : ${manquantes.join(', ')}. ` +
          `Format attendu (ordre) : ${HEADER_ORDONNE.join(', ')}.`,
      );
    }

    // 5. Périmètre RBAC
    const crAutorises = await this.perimetreService.getCrAutorisesPourUser(
      user.userId,
    );

    // 6. Validation ligne par ligne (sans écriture DB)
    const erreurs: ImportBudgetErrorDto[] = [];
    const warnings: ImportBudgetWarningDto[] = [];
    const operations: OperationUpsert[] = [];
    const lignesTotal = rowsBrutes.length;

    for (let i = 0; i < rowsBrutes.length; i++) {
      const ligneNumero = i + 2; // i=0 → ligne 2 du fichier (header=1)
      await this.validerLigne(
        rowsBrutes[i]!,
        ligneNumero,
        versionId,
        scenarioId,
        crAutorises,
        operations,
        erreurs,
        warnings,
      );
    }

    const lignesValides = operations.length;
    const lignesRejetees = erreurs.length;
    const tauxErreurs = lignesTotal === 0 ? 0 : lignesRejetees / lignesTotal;

    // 7. Décision rollback / upsert
    let lignesInserees = 0;
    let lignesModifiees = 0;
    let lignesIgnorees = 0;
    let transactionRollback = false;

    if (tauxErreurs > TAUX_ERREURS_ROLLBACK) {
      transactionRollback = true;
      this.logger.warn(
        `Import ${file.originalname} : ${lignesRejetees}/${lignesTotal} erreurs ` +
          `(${(tauxErreurs * 100).toFixed(1)} %). Transaction annulée.`,
      );
    } else if (operations.length > 0) {
      // 8. Upsert dans une seule transaction
      const stats = await this.dataSource.transaction(async (manager) => {
        return this.executerUpserts(
          manager,
          operations,
          versionId,
          scenarioId,
          user.email,
        );
      });
      lignesInserees = stats.inserees;
      lignesModifiees = stats.modifiees;
      lignesIgnorees = stats.ignorees;
    }

    const dureeMs = Date.now() - start;

    const rapport: ImportBudgetRapportDto = {
      fichier: file.originalname,
      tailleKo: Math.round(file.size / 1024),
      formatDetecte,
      lignesTotal,
      lignesValides,
      lignesInserees,
      lignesModifiees,
      lignesIgnorees,
      lignesRejetees,
      erreurs,
      warnings,
      dureeMs,
      transactionRollback,
    };

    // 9. Audit (succès ou rollback : toujours consigné)
    // Lot 4.2-fix.A : enrichissement via_delegation_id si l'import
    // s'appuie sur une permission BUDGET.SAISIR reçue par délégation.
    const viaDelegationId =
      await this.permissionsService.getDelegationContextPour(
        user.userId,
        'BUDGET.SAISIR',
      );
    await this.auditService.log({
      utilisateur: user.email,
      typeAction: 'IMPORT_BUDGET_BULK',
      entiteCible: 'fait_budget',
      idCible: `version=${versionId}/scenario=${scenarioId}`,
      statut: transactionRollback ? 'failure' : 'success',
      dureeMs,
      payloadApres: {
        fichier: rapport.fichier,
        formatDetecte: rapport.formatDetecte,
        lignesTotal,
        lignesInserees,
        lignesModifiees,
        lignesIgnorees,
        lignesRejetees,
        transactionRollback,
        warningsCount: warnings.length,
        ...(viaDelegationId !== null
          ? { via_delegation_id: viaDelegationId }
          : {}),
      },
      commentaire:
        `Import ${rapport.fichier} (${rapport.formatDetecte}) — ` +
        (transactionRollback
          ? `ROLLBACK (${(tauxErreurs * 100).toFixed(1)} % erreurs).`
          : `${lignesInserees} ins. / ${lignesModifiees} mod. / ${lignesIgnorees} ign. / ${lignesRejetees} rej.`),
    });

    return rapport;
  }

  // ─── Détection format + parsing ──────────────────────────────────

  private detecterFormat(originalname: string): 'csv' | 'xlsx' {
    const lower = originalname.toLowerCase();
    if (lower.endsWith('.csv')) return 'csv';
    if (lower.endsWith('.xlsx')) return 'xlsx';
    throw new BadRequestException(
      `Type de fichier non supporté (${originalname}). Attendu : .csv ou .xlsx.`,
    );
  }

  private async parserFichier(
    buffer: Buffer,
    format: 'csv' | 'xlsx',
  ): Promise<RowBrute[]> {
    if (format === 'csv') return this.parserCsv(buffer);
    return this.parserXlsx(buffer);
  }

  private parserCsv(buffer: Buffer): RowBrute[] {
    // csv-parse auto-détecte point-virgule ou virgule via le sniffing
    // sur le header (option `delimiter: [',', ';', '\t']`). UTF-8 BOM
    // consommé via `bom: true`.
    const rows = parseCsv(buffer, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      bom: true,
      delimiter: [',', ';', '\t'],
    }) as RowBrute[];
    return rows;
  }

  private async parserXlsx(buffer: Buffer): Promise<RowBrute[]> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    const sheet = workbook.worksheets[0];
    if (!sheet) {
      throw new BadRequestException('Fichier XLSX sans onglet exploitable.');
    }
    const headers: string[] = [];
    const rows: RowBrute[] = [];
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      const values: unknown[] = [];
      // exceljs row.values est 1-indexé, [0] est null.
      const raw = row.values as unknown[];
      for (let i = 1; i < raw.length; i++) values.push(raw[i]);
      if (rowNumber === 1) {
        for (const v of values) {
          headers.push(String(v ?? '').trim());
        }
        return;
      }
      const obj: RowBrute = {};
      for (let c = 0; c < headers.length; c++) {
        const cellVal = values[c];
        // Les dates Excel arrivent comme objets Date — on normalise
        // au format ISO YYYY-MM-DD pour la suite.
        if (cellVal instanceof Date) {
          obj[headers[c]!] = cellVal.toISOString().slice(0, 10);
        } else if (cellVal === null || cellVal === undefined) {
          obj[headers[c]!] = '';
        } else {
          obj[headers[c]!] = String(cellVal).trim();
        }
      }
      // Ignore les lignes vides (toutes cellules vides).
      if (Object.values(obj).some((v) => v !== '')) rows.push(obj);
    });
    return rows;
  }

  // ─── Validation ligne par ligne ──────────────────────────────────

  private async validerLigne(
    raw: RowBrute,
    ligneNumero: number,
    versionId: string,
    _scenarioId: string,
    crAutorises: string[] | null,
    operations: OperationUpsert[],
    erreurs: ImportBudgetErrorDto[],
    warnings: ImportBudgetWarningDto[],
  ): Promise<void> {
    const parsed = ligneSchema.safeParse(raw);
    if (!parsed.success) {
      erreurs.push({
        ligneNumero,
        code: 'VALIDATION_FORMAT',
        message: parsed.error.issues
          .map((i) => `${i.path.join('.') || '<row>'}: ${i.message}`)
          .join('; '),
      });
      return;
    }
    const data: LigneValidee = parsed.data;

    // Résolution FK CR
    const cr = await this.dataSource.query<
      Array<{ id: string; fk_structure: string }>
    >(
      `SELECT id, fk_structure FROM dim_centre_responsabilite
        WHERE code_cr = $1 AND version_courante = true AND est_actif = true
        LIMIT 1`,
      [data.code_cr],
    );
    if (cr.length === 0) {
      erreurs.push({
        ligneNumero,
        code: 'CR_INTROUVABLE',
        message: `CR '${data.code_cr}' introuvable ou non courant.`,
        valeurFournie: data.code_cr,
      });
      return;
    }
    const fkCentre = String(cr[0]!.id);
    const fkStructureCr = String(cr[0]!.fk_structure);

    // Périmètre user
    if (crAutorises !== null && !crAutorises.includes(fkCentre)) {
      erreurs.push({
        ligneNumero,
        code: 'CR_PERIMETRE_REFUSE',
        message: `CR '${data.code_cr}' hors de votre périmètre RBAC.`,
        valeurFournie: data.code_cr,
      });
      return;
    }

    // Résolution FK Compte
    const compte = await this.dataSource.query<
      Array<{
        id: string;
        est_compte_collectif: boolean;
      }>
    >(
      `SELECT id, est_compte_collectif FROM dim_compte
        WHERE code_compte = $1 AND version_courante = true
        LIMIT 1`,
      [data.code_compte],
    );
    if (compte.length === 0) {
      erreurs.push({
        ligneNumero,
        code: 'COMPTE_INTROUVABLE',
        message: `Compte '${data.code_compte}' introuvable.`,
        valeurFournie: data.code_compte,
      });
      return;
    }
    if (compte[0]!.est_compte_collectif) {
      erreurs.push({
        ligneNumero,
        code: 'COMPTE_AGREGE',
        message:
          `Saisie sur compte agrégé interdite : '${data.code_compte}' ` +
          `est est_compte_collectif=true.`,
        valeurFournie: data.code_compte,
      });
      return;
    }
    const fkCompte = String(compte[0]!.id);

    // Résolution FK Ligne métier
    const lm = await this.dataSource.query<Array<{ id: string }>>(
      `SELECT id FROM dim_ligne_metier
        WHERE code_ligne_metier = $1 AND version_courante = true
        LIMIT 1`,
      [data.code_ligne_metier],
    );
    if (lm.length === 0) {
      erreurs.push({
        ligneNumero,
        code: 'LIGNE_METIER_INTROUVABLE',
        message: `Ligne métier '${data.code_ligne_metier}' introuvable.`,
        valeurFournie: data.code_ligne_metier,
      });
      return;
    }
    const fkLigneMetier = String(lm[0]!.id);

    // Résolution FK Temps (ramener au 1er du mois)
    const moisIso = data.mois.length === 7 ? `${data.mois}-01` : data.mois;
    const moisPremier = moisIso.slice(0, 7) + '-01';
    const temps = await this.dataSource.query<
      Array<{ id: string; jour: number }>
    >(`SELECT id, jour FROM dim_temps WHERE date = $1 LIMIT 1`, [moisPremier]);
    if (temps.length === 0) {
      erreurs.push({
        ligneNumero,
        code: 'TEMPS_INTROUVABLE',
        message: `Période '${moisPremier}' absente de dim_temps. Seed nécessaire.`,
        valeurFournie: data.mois,
      });
      return;
    }
    if (temps[0]!.jour !== 1) {
      erreurs.push({
        ligneNumero,
        code: 'TEMPS_PAS_PREMIER_DU_MOIS',
        message: `Maille mensuelle exigée — la période doit être le 1er du mois.`,
        valeurFournie: data.mois,
      });
      return;
    }
    const fkTemps = String(temps[0]!.id);

    // Cohérence mode + montants
    let montant: number;
    let encoursMoyen: number | null = null;
    let tie: number | null = null;
    if (data.mode_saisie === 'MONTANT') {
      const m = Number(data.montant);
      if (!Number.isFinite(m)) {
        erreurs.push({
          ligneNumero,
          code: 'VALIDATION_FORMAT',
          message: `Montant invalide : '${data.montant}'.`,
          valeurFournie: data.montant ?? '',
        });
        return;
      }
      montant = m;
    } else {
      const e = Number(data.encours_moyen);
      const t = Number(data.tie);
      if (!Number.isFinite(e) || !Number.isFinite(t)) {
        erreurs.push({
          ligneNumero,
          code: 'ENCOURS_TIE_CHAMPS_MANQUANTS',
          message:
            'Mode ENCOURS_TIE — encours_moyen et tie doivent être des nombres.',
        });
        return;
      }
      if (t < 0 || t > 1) {
        erreurs.push({
          ligneNumero,
          code: 'TIE_HORS_BORNES',
          message: `tie doit être entre 0 et 1 (reçu ${t}).`,
          valeurFournie: data.tie ?? '',
        });
        return;
      }
      encoursMoyen = e;
      tie = t;
      const recalcule = Number(((e * t) / 12).toFixed(2));
      const fourni = data.montant === null ? null : Number(data.montant);
      montant = recalcule;
      if (fourni !== null && Math.abs(fourni - recalcule) > 0.01) {
        warnings.push({
          ligneNumero,
          code: 'MONTANT_RECALCULE',
          message:
            `Montant recalculé à ${recalcule} (encours×tie/12) — ` +
            `valeur fournie ${fourni} écrasée.`,
        });
      }
    }

    // Commentaire troncature
    let commentaire = data.commentaire;
    if (commentaire && commentaire.length > 2000) {
      commentaire = commentaire.slice(0, 2000);
      warnings.push({
        ligneNumero,
        code: 'COMMENTAIRE_TRONQUE',
        message: 'Commentaire tronqué à 2000 caractères.',
      });
    }

    // Résolution FK défauts (devise XOF, produit & segment).
    // Si elle échoue, on remonte une erreur globale (cas rare —
    // problème de seed) pour éviter de polluer toutes les lignes.
    const defaults = await this.resoudreFkDefaults(versionId);
    if (!defaults.ok) {
      erreurs.push({
        ligneNumero,
        code: 'AUTRE',
        message: defaults.message,
      });
      return;
    }

    operations.push({
      ligneNumero,
      fkTemps,
      fkCompte,
      fkCentre,
      fkStructure: fkStructureCr,
      fkLigneMetier,
      fkProduit: defaults.fkProduit,
      fkSegment: defaults.fkSegment,
      fkDevise: defaults.fkDevise,
      modeSaisie: data.mode_saisie,
      montant,
      encoursMoyen,
      tie,
      commentaire,
    });
  }

  // ─── Helpers ─────────────────────────────────────────────────────

  private async assertVersionOuverte(versionId: string): Promise<void> {
    const rows = await this.dataSource.query<
      Array<{ statut: string; code_version: string }>
    >(`SELECT statut, code_version FROM dim_version WHERE id = $1`, [
      versionId,
    ]);
    if (rows.length === 0) {
      throw new NotFoundException(`Version ${versionId} introuvable.`);
    }
    if (rows[0]!.statut !== 'ouvert') {
      throw new ConflictException(
        `Import refusé : la version ${rows[0]!.code_version} est au statut ` +
          `'${rows[0]!.statut}'. Seul le statut 'ouvert' (Brouillon) autorise l'import.`,
      );
    }
  }

  /**
   * Résolution des FK par défaut (mêmes règles que
   * BudgetSaisieService.resoudreFkDefaultsPourInsert pour le Lot 3.4) —
   * dupliquée ici pour ne pas casser l'API privée du service de
   * saisie. Comme ces valeurs sont globales (pas dépendantes du CR ou
   * du mois), le résultat est mémorisé pour la durée de l'import.
   */
  private defaultsCache: {
    fkDevise: string;
    fkProduit: string;
    fkSegment: string;
  } | null = null;

  private async resoudreFkDefaults(
    _versionId: string,
  ): Promise<
    | { ok: true; fkDevise: string; fkProduit: string; fkSegment: string }
    | { ok: false; message: string }
  > {
    if (this.defaultsCache) return { ok: true, ...this.defaultsCache };

    const xof = await this.dataSource.query<Array<{ id: string }>>(
      `SELECT id FROM dim_devise WHERE code_iso='XOF' LIMIT 1`,
    );
    if (xof.length === 0) {
      return { ok: false, message: 'Devise pivot XOF introuvable.' };
    }
    const produitT = await this.dataSource.query<Array<{ id: string }>>(
      `SELECT id FROM dim_produit
        WHERE code_produit = 'PRODUIT_TRANSVERSE' AND version_courante = true
        LIMIT 1`,
    );
    const produitFb = await this.dataSource.query<Array<{ id: string }>>(
      `SELECT id FROM dim_produit
        WHERE version_courante = true AND est_actif = true
        ORDER BY niveau ASC, code_produit ASC LIMIT 1`,
    );
    const fkProduit = produitT[0]?.id ?? produitFb[0]?.id ?? null;
    if (!fkProduit) {
      return { ok: false, message: 'Aucun produit par défaut disponible.' };
    }
    const segment = await this.dataSource.query<Array<{ id: string }>>(
      `SELECT id FROM dim_segment
        WHERE version_courante = true AND est_actif = true
        ORDER BY code_segment ASC LIMIT 1`,
    );
    if (segment.length === 0) {
      return { ok: false, message: 'Aucun segment courant disponible.' };
    }
    this.defaultsCache = {
      fkDevise: String(xof[0]!.id),
      fkProduit: String(fkProduit),
      fkSegment: String(segment[0]!.id),
    };
    return { ok: true, ...this.defaultsCache };
  }

  // ─── Upsert transactionnel ───────────────────────────────────────

  private async executerUpserts(
    manager: EntityManager,
    operations: OperationUpsert[],
    versionId: string,
    scenarioId: string,
    userEmail: string,
  ): Promise<{ inserees: number; modifiees: number; ignorees: number }> {
    let inserees = 0;
    let modifiees = 0;
    let ignorees = 0;

    for (const op of operations) {
      // Recherche d'une ligne existante au grain (uq_fait_budget_grain).
      const existing = await manager.query<
        Array<{
          id: string;
          montant_devise: string;
          mode_saisie: string;
          encours_moyen: string | null;
          tie: string | null;
          commentaire: string | null;
        }>
      >(
        `SELECT id, montant_devise, mode_saisie, encours_moyen, tie, commentaire
           FROM fait_budget
          WHERE fk_temps = $1 AND fk_compte = $2 AND fk_structure = $3
            AND fk_centre = $4 AND fk_ligne_metier = $5 AND fk_produit = $6
            AND fk_segment = $7 AND fk_devise = $8 AND fk_version = $9
            AND fk_scenario = $10
          LIMIT 1`,
        [
          op.fkTemps,
          op.fkCompte,
          op.fkStructure,
          op.fkCentre,
          op.fkLigneMetier,
          op.fkProduit,
          op.fkSegment,
          op.fkDevise,
          versionId,
          scenarioId,
        ],
      );

      if (existing.length === 0) {
        // INSERT — on cale montant_fcfa = montant_devise et
        // taux_change_applique = 1 (devise pivot XOF — saisie en
        // FCFA, pas de conversion). Cohérent avec
        // BudgetSaisieService.saveGrilleSaisie (Lot 3.4).
        await manager.query(
          `INSERT INTO fait_budget (
             fk_temps, fk_compte, fk_structure, fk_centre, fk_ligne_metier,
             fk_produit, fk_segment, fk_devise, fk_version, fk_scenario,
             montant_devise, montant_fcfa, taux_change_applique,
             mode_saisie, encours_moyen, tie,
             commentaire, utilisateur_creation
           ) VALUES (
             $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
             $11,$11,1,$12,$13,$14,$15,$16
           )`,
          [
            op.fkTemps,
            op.fkCompte,
            op.fkStructure,
            op.fkCentre,
            op.fkLigneMetier,
            op.fkProduit,
            op.fkSegment,
            op.fkDevise,
            versionId,
            scenarioId,
            op.montant,
            op.modeSaisie,
            op.encoursMoyen,
            op.tie,
            op.commentaire,
            userEmail,
          ],
        );
        inserees++;
      } else {
        const e = existing[0]!;
        const inchange =
          Number(e.montant_devise) === op.montant &&
          e.mode_saisie === op.modeSaisie &&
          (e.encours_moyen === null
            ? op.encoursMoyen === null
            : Number(e.encours_moyen) === op.encoursMoyen) &&
          (e.tie === null ? op.tie === null : Number(e.tie) === op.tie) &&
          (e.commentaire ?? null) === (op.commentaire ?? null);
        if (inchange) {
          ignorees++;
          continue;
        }
        await manager.query(
          `UPDATE fait_budget
              SET montant_devise = $1, montant_fcfa = $1,
                  mode_saisie = $2, encours_moyen = $3, tie = $4,
                  commentaire = $5,
                  date_modification = CURRENT_TIMESTAMP,
                  utilisateur_modification = $6
            WHERE id = $7`,
          [
            op.montant,
            op.modeSaisie,
            op.encoursMoyen,
            op.tie,
            op.commentaire,
            userEmail,
            e.id,
          ],
        );
        modifiees++;
      }
    }

    return { inserees, modifiees, ignorees };
  }
}

// Re-export pour les controller : codes d'erreur exposés aux consommateurs.
export type { ImportBudgetErrorCode };
