/**
 * RealiseImportService (Lot 5.1) — import en masse Excel/CSV de
 * lignes fait_realise.
 *
 * Pipeline :
 *  1. Détection format (.csv → csv-parse, .xlsx → exceljs).
 *  2. Validation header (6 colonnes obligatoires).
 *  3. Validation ligne par ligne (zod) + résolution FK
 *     (code_cr, code_compte, code_ligne_metier, code_devise,
 *     mois → fk_temps).
 *  4. Filtrage périmètre user_perimetres en écriture.
 *  5. Stratégie UPSERT :
 *     - existant en VALIDE  → ligne ignorée avec raison
 *     - existant en IMPORTE → UPDATE (montant/mode/commentaire)
 *     - sinon → INSERT (statut=IMPORTE, source=IMPORT)
 *  6. Tout dans une seule transaction TypeORM (rollback complet
 *     si erreur fatale).
 *  7. Rapport final retourné + 1 ligne audit IMPORTER_REALISE
 *     (récap uniquement, pas le détail des lignes).
 *
 * Réutilise le pattern de BudgetImportService (Lot 3.7) — parsing
 * CSV via csv-parse/sync, parsing XLSX via exceljs.
 */
import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { parse as parseCsv } from 'csv-parse/sync';
import ExcelJS from 'exceljs';
import { DataSource, EntityManager } from 'typeorm';
import { z } from 'zod';

import { AuditService } from '../../audit/audit.service';
import { PerimetreService } from '../../budget/services/perimetre.service';
import { RapportImportRealiseDto } from '../dto/realise.dto';
import { FaitRealise } from '../entities/fait-realise.entity';

const HEADER_ORDONNE = [
  'code_cr',
  'code_compte',
  'code_ligne_metier',
  'mois',
  'code_devise',
  'montant',
] as const;

type RowBrute = Record<string, string>;

const ligneSchema = z.object({
  code_cr: z.string().min(1, 'Obligatoire'),
  code_compte: z.string().min(1, 'Obligatoire'),
  code_ligne_metier: z.string().min(1, 'Obligatoire'),
  mois: z
    .string()
    .regex(/^\d{4}-\d{2}(-\d{2})?$/, 'Format YYYY-MM ou YYYY-MM-DD attendu'),
  code_devise: z.string().min(1, 'Obligatoire'),
  montant: z
    .string()
    .min(1, 'Obligatoire')
    .transform((v, ctx) => {
      const n = Number(v.replace(',', '.'));
      if (Number.isNaN(n)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Montant non numérique',
        });
        return z.NEVER;
      }
      return n;
    }),
  mode: z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? 'MNT' : v.toUpperCase()))
    .refine((v) => ['MNT', 'VOL', 'UNIT'].includes(v), {
      message: 'mode doit être MNT, VOL ou UNIT',
    }),
  commentaire: z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? null : v)),
});

type LigneValidee = z.infer<typeof ligneSchema>;

interface OperationRealise {
  ligneNumero: number;
  fkCentreResponsabilite: string;
  fkCompte: string;
  fkLigneMetier: string;
  fkTemps: string;
  fkDevise: string;
  montant: number;
  mode: 'MNT' | 'VOL' | 'UNIT';
  commentaire: string | null;
}

@Injectable()
export class RealiseImportService {
  private readonly logger = new Logger(RealiseImportService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly perimetreService: PerimetreService,
    private readonly auditService: AuditService,
  ) {}

  async importFichier(
    file: { buffer: Buffer; originalname: string; size: number },
    user: { userId: string; email: string },
  ): Promise<RapportImportRealiseDto> {
    const start = Date.now();

    // 1. Format
    const format = this.detecterFormat(file.originalname);

    // 2. Parsing
    const rowsBrutes = await this.parserFichier(file.buffer, format);
    if (rowsBrutes.length === 0) {
      throw new BadRequestException(
        'Fichier vide ou aucune ligne de données après le header.',
      );
    }

    // 3. Validation header
    const colonnesPresentes = Object.keys(rowsBrutes[0]!);
    const manquantes = HEADER_ORDONNE.filter(
      (c) => !colonnesPresentes.includes(c),
    );
    if (manquantes.length > 0) {
      throw new BadRequestException(
        `Header invalide. Colonnes manquantes : ${manquantes.join(', ')}. ` +
          `Format attendu : ${HEADER_ORDONNE.join(', ')} (+ optionnel : mode, commentaire).`,
      );
    }

    // 4. Périmètre user
    const crAutorises = await this.perimetreService.getCrAutorisesPourUser(
      user.userId,
    );

    // 5. Validation ligne par ligne (sans écriture DB)
    const erreurs: Array<{ ligne: number; message: string }> = [];
    const lignesIgnoreesPourPerimetre: Array<{
      ligne: number;
      raison: string;
    }> = [];
    const operations: OperationRealise[] = [];

    for (let i = 0; i < rowsBrutes.length; i++) {
      const ligneNumero = i + 2; // 1 = header
      await this.validerLigne(
        rowsBrutes[i]!,
        ligneNumero,
        crAutorises,
        operations,
        erreurs,
        lignesIgnoreesPourPerimetre,
      );
    }

    // 6. Upsert transactionnel
    let nbCreees = 0;
    let nbMisesAJour = 0;
    let nbIgnoreesValides = 0;
    const ignoreesValides: Array<{ ligne: number; raison: string }> = [];

    if (operations.length > 0) {
      const stats = await this.dataSource.transaction(async (manager) => {
        return this.executerUpserts(manager, operations, user.email);
      });
      nbCreees = stats.creees;
      nbMisesAJour = stats.misesAJour;
      nbIgnoreesValides = stats.ignoreesValide.length;
      ignoreesValides.push(...stats.ignoreesValide);
    }

    // 7. Rapport
    const rapport: RapportImportRealiseDto = {
      nbLignesTraitees: rowsBrutes.length,
      nbLignesCreees: nbCreees,
      nbLignesMisesAJour: nbMisesAJour,
      nbLignesIgnorees:
        lignesIgnoreesPourPerimetre.length + nbIgnoreesValides,
      nbErreurs: erreurs.length,
      erreurs,
      lignesIgnorees: [...lignesIgnoreesPourPerimetre, ...ignoreesValides],
    };

    // 8. Audit (récap)
    await this.auditService.log({
      utilisateur: user.email,
      typeAction: 'IMPORTER_REALISE',
      entiteCible: 'fait_realise',
      idCible: file.originalname,
      statut: rapport.nbErreurs === 0 ? 'success' : 'failure',
      payloadApres: {
        fichier: file.originalname,
        format,
        ...rapport,
      },
      dureeMs: Date.now() - start,
      commentaire:
        `Import réalisé ${file.originalname} — ` +
        `${nbCreees} créée(s), ${nbMisesAJour} maj, ${rapport.nbLignesIgnorees} ignorée(s), ` +
        `${rapport.nbErreurs} erreur(s).`,
    });

    return rapport;
  }

  // ─── Helpers ────────────────────────────────────────────────────

  private detecterFormat(filename: string): 'csv' | 'xlsx' {
    const ext = filename.toLowerCase().split('.').pop();
    if (ext === 'csv') return 'csv';
    if (ext === 'xlsx') return 'xlsx';
    throw new BadRequestException(
      `Format de fichier non supporté : ${ext}. Attendu : .csv ou .xlsx.`,
    );
  }

  private async parserFichier(
    buffer: Buffer,
    format: 'csv' | 'xlsx',
  ): Promise<RowBrute[]> {
    if (format === 'csv') {
      const rows = parseCsv(buffer, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      }) as RowBrute[];
      return rows;
    }
    const workbook = new ExcelJS.Workbook();
    // Cast aligné sur BudgetImportService (Lot 3.7).
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    const ws = workbook.worksheets[0];
    if (!ws) {
      throw new BadRequestException('Fichier XLSX sans feuille active.');
    }
    const rows: RowBrute[] = [];
    let headers: string[] = [];
    ws.eachRow((row, rowIndex) => {
      if (rowIndex === 1) {
        headers = (row.values as Array<unknown>)
          .slice(1)
          .map((v) => String(v ?? '').trim());
        return;
      }
      const obj: RowBrute = {};
      const cells = row.values as Array<unknown>;
      for (let c = 0; c < headers.length; c++) {
        const cellVal = cells[c + 1];
        if (cellVal instanceof Date) {
          obj[headers[c]!] = cellVal.toISOString().slice(0, 10);
        } else if (cellVal === null || cellVal === undefined) {
          obj[headers[c]!] = '';
        } else {
          obj[headers[c]!] = String(cellVal).trim();
        }
      }
      if (Object.values(obj).some((v) => v !== '')) rows.push(obj);
    });
    return rows;
  }

  private async validerLigne(
    raw: RowBrute,
    ligneNumero: number,
    crAutorises: string[] | null,
    operations: OperationRealise[],
    erreurs: Array<{ ligne: number; message: string }>,
    ignoreesPerimetre: Array<{ ligne: number; raison: string }>,
  ): Promise<void> {
    const parsed = ligneSchema.safeParse(raw);
    if (!parsed.success) {
      erreurs.push({
        ligne: ligneNumero,
        message: parsed.error.issues
          .map((i) => `${i.path.join('.') || '<row>'}: ${i.message}`)
          .join('; '),
      });
      return;
    }
    const data: LigneValidee = parsed.data;

    // Résolution FK CR
    const cr = await this.dataSource.query<Array<{ id: string }>>(
      `SELECT id FROM dim_centre_responsabilite
        WHERE code_cr = $1 AND version_courante = true AND est_actif = true
        LIMIT 1`,
      [data.code_cr],
    );
    if (cr.length === 0) {
      erreurs.push({
        ligne: ligneNumero,
        message: `Code CR '${data.code_cr}' introuvable ou non courant.`,
      });
      return;
    }
    const fkCentre = String(cr[0]!.id);

    // Périmètre
    if (crAutorises !== null && !crAutorises.includes(fkCentre)) {
      ignoreesPerimetre.push({
        ligne: ligneNumero,
        raison: `CR '${data.code_cr}' hors de votre périmètre user_perimetres.`,
      });
      return;
    }

    // FK compte
    const compte = await this.dataSource.query<Array<{ id: string }>>(
      `SELECT id FROM dim_compte
        WHERE code_compte = $1 AND version_courante = true LIMIT 1`,
      [data.code_compte],
    );
    if (compte.length === 0) {
      erreurs.push({
        ligne: ligneNumero,
        message: `Code compte '${data.code_compte}' introuvable ou non courant.`,
      });
      return;
    }

    // FK ligne_metier
    const lm = await this.dataSource.query<Array<{ id: string }>>(
      `SELECT id FROM dim_ligne_metier
        WHERE code_ligne_metier = $1 AND version_courante = true LIMIT 1`,
      [data.code_ligne_metier],
    );
    if (lm.length === 0) {
      erreurs.push({
        ligne: ligneNumero,
        message: `Code ligne métier '${data.code_ligne_metier}' introuvable ou non courant.`,
      });
      return;
    }

    // FK devise
    const dev = await this.dataSource.query<Array<{ id: string }>>(
      `SELECT id FROM dim_devise
        WHERE code_iso = $1 AND est_active = true LIMIT 1`,
      [data.code_devise.toUpperCase()],
    );
    if (dev.length === 0) {
      erreurs.push({
        ligne: ligneNumero,
        message: `Code devise '${data.code_devise}' introuvable ou inactive.`,
      });
      return;
    }

    // FK temps (1er du mois)
    const moisIso = data.mois.length === 7 ? `${data.mois}-01` : data.mois;
    const t = await this.dataSource.query<Array<{ id: string }>>(
      `SELECT id FROM dim_temps WHERE date = $1::date AND jour = 1 LIMIT 1`,
      [moisIso],
    );
    if (t.length === 0) {
      erreurs.push({
        ligne: ligneNumero,
        message: `Mois '${data.mois}' introuvable dans dim_temps (1er du mois requis).`,
      });
      return;
    }

    operations.push({
      ligneNumero,
      fkCentreResponsabilite: fkCentre,
      fkCompte: String(compte[0]!.id),
      fkLigneMetier: String(lm[0]!.id),
      fkTemps: String(t[0]!.id),
      fkDevise: String(dev[0]!.id),
      montant: data.montant,
      mode: data.mode as 'MNT' | 'VOL' | 'UNIT',
      commentaire: data.commentaire,
    });
  }

  private async executerUpserts(
    manager: EntityManager,
    operations: OperationRealise[],
    auteurEmail: string,
  ): Promise<{
    creees: number;
    misesAJour: number;
    ignoreesValide: Array<{ ligne: number; raison: string }>;
  }> {
    const repo = manager.getRepository(FaitRealise);
    let creees = 0;
    let misesAJour = 0;
    const ignoreesValide: Array<{ ligne: number; raison: string }> = [];

    for (const op of operations) {
      const existant = await repo.findOne({
        where: {
          fkCentreResponsabilite: op.fkCentreResponsabilite,
          fkCompte: op.fkCompte,
          fkLigneMetier: op.fkLigneMetier,
          fkTemps: op.fkTemps,
          fkDevise: op.fkDevise,
        },
      });
      if (existant) {
        if (existant.statut === 'VALIDE') {
          ignoreesValide.push({
            ligne: op.ligneNumero,
            raison: `Ligne déjà validée (id=${existant.id}) — supprimer/dévalider d'abord.`,
          });
          continue;
        }
        existant.montant = op.montant;
        existant.mode = op.mode;
        existant.commentaire = op.commentaire;
        existant.source = 'IMPORT';
        existant.dateModification = new Date();
        existant.utilisateurModification = auteurEmail;
        await repo.save(existant);
        misesAJour++;
      } else {
        const nouveau = repo.create({
          fkCentreResponsabilite: op.fkCentreResponsabilite,
          fkCompte: op.fkCompte,
          fkLigneMetier: op.fkLigneMetier,
          fkTemps: op.fkTemps,
          fkDevise: op.fkDevise,
          montant: op.montant,
          mode: op.mode,
          tauxChangeApplique: 1,
          statut: 'IMPORTE',
          source: 'IMPORT',
          commentaire: op.commentaire,
          utilisateurCreation: auteurEmail,
        });
        await repo.save(nouveau);
        creees++;
      }
    }
    return { creees, misesAJour, ignoreesValide };
  }
}
