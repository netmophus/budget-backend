/**
 * R04BudgetBceaoService (Lot 7.6 — Palier 2) — extraction des données
 * du rapport R04 "Budget Publié BCEAO" + orchestration de la
 * génération PDF.
 *
 * Le service N'EXPOSE PAS d'endpoint HTTP : il est consommé par
 * `ReportingController` (Palier 3) qui se charge du streaming, du
 * Content-Disposition et de l'audit log d'export.
 *
 * Règles métier :
 *  - Le R04 n'est disponible QUE pour les versions au statut `gele`.
 *    Toute autre version lève `ConflictException` 409.
 *  - Si la version n'existe pas → `NotFoundException` 404.
 *  - L'audit trail (Query 6) est filtré sur les actions postérieures
 *    à `dim_version.date_soumission` pour exclure les anciennes traces
 *    en cas de cycle réouvert (e.g. version rejetée puis re-soumise).
 */
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { ConfigurationBanqueService } from '../../configuration-banque/configuration-banque.service';
import { ExcelBuilderService } from '../generators/excel-builder.service';
import { PdfBuilderService } from '../generators/pdf-builder.service';
import { buildR04Xlsx } from '../templates/r04-budget-bceao.excel.template';
import { buildR04Pdf } from '../templates/r04-budget-bceao.template';

export interface R04VersionMetadata {
  id: string;
  code_version: string;
  libelle: string;
  type_version: string;
  exercice_fiscal: number;
  statut: string;
  date_soumission: string | null;
  utilisateur_soumission: string | null;
  commentaire_soumission: string | null;
  date_validation: string | null;
  utilisateur_validation: string | null;
  commentaire_validation: string | null;
  date_gel: string | null;
  utilisateur_gel: string | null;
  commentaire_publication: string | null;
  // Lot 7.6.bis fix #4 — noms complets pour signatures nominatives.
  // LEFT JOIN : null si user supprimé après publication (le template
  // fallback sur l'email dans ce cas).
  nom_soumetteur: string | null;
  nom_validateur: string | null;
  nom_publicateur: string | null;
}

export interface R04Totaux {
  nb_lignes: number;
  nb_comptes: number;
  nb_cr: number;
  total_produits: number;
  total_charges: number;
}

export interface R04LigneCr {
  id: string;
  code_cr: string;
  libelle: string;
  type_cr: string;
  produits: number;
  charges: number;
  nb_comptes: number;
  nb_lignes: number;
}

export interface R04LigneCompte {
  id: string;
  code_compte: string;
  libelle: string;
  classe: string;
  sens: string | null;
  montant_total: number;
  nb_lignes: number;
}

export interface R04LigneSousClasse {
  classe: string;
  sous_classe: string;
  montant: number;
}

export interface R04AuditEntry {
  id: string;
  date_action: string;
  utilisateur: string;
  type_action: string;
  commentaire: string | null;
}

export interface R04Donnees {
  version: R04VersionMetadata;
  totaux: R04Totaux;
  ventilationCr: R04LigneCr[];
  detailComptes: R04LigneCompte[];
  comptedeResultat: R04LigneSousClasse[];
  auditTrail: R04AuditEntry[];
}

@Injectable()
export class R04BudgetBceaoService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly pdfBuilder: PdfBuilderService,
    private readonly excelBuilder: ExcelBuilderService,
    private readonly configBanque: ConfigurationBanqueService,
  ) {}

  /**
   * Extrait toutes les données nécessaires au rapport R04 en un seul
   * appel. Vérifie d'abord que la version existe et est publiée (gel),
   * sinon throw avant de lancer les agrégations.
   */
  async extractDonnees(versionId: string): Promise<R04Donnees> {
    const version = await this.queryVersion(versionId);
    if (!version) {
      throw new NotFoundException(`Version ${versionId} introuvable.`);
    }
    if (version.statut !== 'gele') {
      throw new ConflictException(
        "Le rapport R4 n'est disponible que pour les versions publiées (gelées).",
      );
    }

    const [totaux, ventilationCr, detailComptes, comptedeResultat, auditTrail] =
      await Promise.all([
        this.queryTotaux(versionId),
        this.queryVentilationCr(versionId),
        this.queryDetailComptes(versionId),
        this.queryCompteResultat(versionId),
        this.queryAuditTrail(versionId, version.date_soumission),
      ]);

    return {
      version,
      totaux,
      ventilationCr,
      detailComptes,
      comptedeResultat,
      auditTrail,
    };
  }

  /**
   * Génère le PDF complet du rapport R04 et retourne un Buffer prêt à
   * être streamé. Validation statut/existence faite en amont par
   * `extractDonnees()`.
   */
  async genererPdfBuffer(versionId: string): Promise<Buffer> {
    const donnees = await this.extractDonnees(versionId);
    const bank = await this.configBanque.getBankBranding();

    const doc = this.pdfBuilder.createDocument({
      title: `${donnees.version.code_version} — Snapshot BCEAO`,
      author: `MIZNAS — ${bank.nom}`,
      subject: `Rapport R04 — Budget Publié BCEAO ${donnees.version.exercice_fiscal}`,
    });

    buildR04Pdf(doc, donnees, this.pdfBuilder, bank);

    // Lot 7.6.bis amélioration #2 — header récurrent (pages 2 à fin).
    this.pdfBuilder.applyHeaderToAllPagesExceptFirst(doc, {
      left: `${bank.nom} S.A.`,
      center: `Budget ${donnees.version.exercice_fiscal} — Snapshot BCEAO`,
      right: `R04 — ${donnees.version.code_version}`,
    });

    this.pdfBuilder.applyFooterToAllPages(
      doc,
      {
        left: `${bank.nom} S.A. — Budget ${donnees.version.exercice_fiscal} — ${donnees.version.code_version} — R04 BCEAO`,
        center: 'CONFIDENTIEL',
      },
      { skipFirstPage: true },
    );

    return new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', (err: Error) => reject(err));
      doc.end();
    });
  }

  /**
   * Génère le workbook XLSX complet du rapport R04 et retourne un
   * Buffer prêt à être streamé. Même cycle qu'`extractDonnees` :
   * validation amont 404/409 avant la construction du workbook.
   */
  async genererXlsxBuffer(versionId: string): Promise<Buffer> {
    const donnees = await this.extractDonnees(versionId);
    const bank = await this.configBanque.getBankBranding();
    const wb = this.excelBuilder.createWorkbook({
      title: `${donnees.version.code_version} — Snapshot BCEAO`,
      subject: `Rapport R04 — Budget Publié BCEAO ${donnees.version.exercice_fiscal}`,
      bankNom: bank.nom,
    });
    buildR04Xlsx(wb, donnees, this.excelBuilder);
    return this.excelBuilder.toBuffer(wb);
  }

  // ─── Queries SQL ────────────────────────────────────────────────

  private async queryVersion(
    versionId: string,
  ): Promise<R04VersionMetadata | null> {
    // Lot 7.6.bis fix #4 — LEFT JOIN "user" (table reserved Postgres,
    // guillemets obligatoires) pour résoudre le nom complet de chaque
    // acteur du workflow. Null si user supprimé/inexistant : le
    // template fallback sur l'email dans ce cas.
    const rows = await this.dataSource.query<R04VersionMetadata[]>(
      `SELECT
         v.id, v.code_version, v.libelle, v.type_version,
         v.exercice_fiscal, v.statut,
         v.date_soumission, v.utilisateur_soumission, v.commentaire_soumission,
         v.date_validation, v.utilisateur_validation, v.commentaire_validation,
         v.date_gel, v.utilisateur_gel, v.commentaire_publication,
         (u_soum.prenom || ' ' || u_soum.nom) AS nom_soumetteur,
         (u_valid.prenom || ' ' || u_valid.nom) AS nom_validateur,
         (u_gel.prenom || ' ' || u_gel.nom) AS nom_publicateur
       FROM dim_version v
       LEFT JOIN "user" u_soum ON u_soum.email = v.utilisateur_soumission
       LEFT JOIN "user" u_valid ON u_valid.email = v.utilisateur_validation
       LEFT JOIN "user" u_gel ON u_gel.email = v.utilisateur_gel
       WHERE v.id = $1`,
      [versionId],
    );
    return rows[0] ?? null;
  }

  private async queryTotaux(versionId: string): Promise<R04Totaux> {
    const rows = await this.dataSource.query<
      Array<{
        nb_lignes: string;
        nb_comptes: string;
        nb_cr: string;
        total_produits: string;
        total_charges: string;
      }>
    >(
      `SELECT
         COUNT(*) AS nb_lignes,
         COUNT(DISTINCT fb.fk_compte) AS nb_comptes,
         COUNT(DISTINCT fb.fk_centre) AS nb_cr,
         COALESCE(SUM(CASE WHEN c.classe = '7' THEN fb.montant_fcfa ELSE 0 END), 0) AS total_produits,
         COALESCE(SUM(CASE WHEN c.classe = '6' THEN fb.montant_fcfa ELSE 0 END), 0) AS total_charges
       FROM fait_budget fb
       JOIN dim_compte c ON c.id = fb.fk_compte
       WHERE fb.fk_version = $1`,
      [versionId],
    );
    const r = rows[0];
    return {
      nb_lignes: Number(r?.nb_lignes ?? 0),
      nb_comptes: Number(r?.nb_comptes ?? 0),
      nb_cr: Number(r?.nb_cr ?? 0),
      total_produits: Number(r?.total_produits ?? 0),
      total_charges: Number(r?.total_charges ?? 0),
    };
  }

  private async queryVentilationCr(versionId: string): Promise<R04LigneCr[]> {
    const rows = await this.dataSource.query<
      Array<{
        id: string;
        code_cr: string;
        libelle: string;
        type_cr: string;
        produits: string;
        charges: string;
        nb_comptes: string;
        nb_lignes: string;
      }>
    >(
      `SELECT
         cr.id, cr.code_cr, cr.libelle, cr.type_cr,
         COALESCE(SUM(CASE WHEN c.classe = '7' THEN fb.montant_fcfa ELSE 0 END), 0) AS produits,
         COALESCE(SUM(CASE WHEN c.classe = '6' THEN fb.montant_fcfa ELSE 0 END), 0) AS charges,
         COUNT(DISTINCT fb.fk_compte) AS nb_comptes,
         COUNT(*) AS nb_lignes
       FROM fait_budget fb
       JOIN dim_compte c ON c.id = fb.fk_compte
       JOIN dim_centre_responsabilite cr ON cr.id = fb.fk_centre
       WHERE fb.fk_version = $1
       GROUP BY cr.id, cr.code_cr, cr.libelle, cr.type_cr
       ORDER BY cr.id`,
      [versionId],
    );
    return rows.map((r) => ({
      id: String(r.id),
      code_cr: r.code_cr,
      libelle: r.libelle,
      type_cr: r.type_cr,
      produits: Number(r.produits),
      charges: Number(r.charges),
      nb_comptes: Number(r.nb_comptes),
      nb_lignes: Number(r.nb_lignes),
    }));
  }

  private async queryDetailComptes(
    versionId: string,
  ): Promise<R04LigneCompte[]> {
    const rows = await this.dataSource.query<
      Array<{
        id: string;
        code_compte: string;
        libelle: string;
        classe: string;
        sens: string | null;
        montant_total: string;
        nb_lignes: string;
      }>
    >(
      `SELECT
         c.id, c.code_compte, c.libelle, c.classe, c.sens,
         COALESCE(SUM(fb.montant_fcfa), 0) AS montant_total,
         COUNT(*) AS nb_lignes
       FROM fait_budget fb
       JOIN dim_compte c ON c.id = fb.fk_compte
       WHERE fb.fk_version = $1
       GROUP BY c.id, c.code_compte, c.libelle, c.classe, c.sens
       ORDER BY c.classe, c.code_compte`,
      [versionId],
    );
    return rows.map((r) => ({
      id: String(r.id),
      code_compte: r.code_compte,
      libelle: r.libelle,
      classe: r.classe,
      sens: r.sens,
      montant_total: Number(r.montant_total),
      nb_lignes: Number(r.nb_lignes),
    }));
  }

  private async queryCompteResultat(
    versionId: string,
  ): Promise<R04LigneSousClasse[]> {
    const rows = await this.dataSource.query<
      Array<{
        classe: string;
        sous_classe: string;
        montant: string;
      }>
    >(
      `SELECT
         c.classe,
         SUBSTRING(c.code_compte, 1, 2) AS sous_classe,
         COALESCE(SUM(fb.montant_fcfa), 0) AS montant
       FROM fait_budget fb
       JOIN dim_compte c ON c.id = fb.fk_compte
       WHERE fb.fk_version = $1
         AND c.classe IN ('6', '7')
       GROUP BY c.classe, SUBSTRING(c.code_compte, 1, 2)
       ORDER BY c.classe, sous_classe`,
      [versionId],
    );
    return rows.map((r) => ({
      classe: r.classe,
      sous_classe: r.sous_classe,
      montant: Number(r.montant),
    }));
  }

  /**
   * Audit trail filtré sur le cycle COURANT — uniquement les actions
   * postérieures à la dernière soumission. Sans ce filtre, une version
   * réouverte (rejet → re-soumission) renvoie aussi les anciennes
   * traces, polluant le rapport BCEAO officiel.
   *
   * Si `dateSoumissionRef` est null (cas théorique d'une version gelée
   * sans soumission tracée), on retourne toutes les actions workflow.
   */
  private async queryAuditTrail(
    versionId: string,
    dateSoumissionRef: string | null,
  ): Promise<R04AuditEntry[]> {
    const params: Array<string> = [versionId];
    let dateFilter = '';
    if (dateSoumissionRef) {
      params.push(dateSoumissionRef);
      dateFilter = ' AND date_action >= $2';
    }
    const rows = await this.dataSource.query<
      Array<{
        id: string;
        date_action: string;
        utilisateur: string;
        type_action: string;
        commentaire: string | null;
      }>
    >(
      `SELECT
         id, date_action, utilisateur, type_action, commentaire
       FROM audit_log
       WHERE entite_cible = 'dim_version'
         AND id_cible = $1::text
         AND type_action IN ('SOUMETTRE_BUDGET', 'VALIDER_BUDGET', 'PUBLIER_BUDGET')
         ${dateFilter}
       ORDER BY date_action ASC`,
      params,
    );
    return rows.map((r) => ({
      id: String(r.id),
      date_action:
        typeof r.date_action === 'string'
          ? r.date_action
          : new Date(r.date_action).toISOString(),
      utilisateur: r.utilisateur,
      type_action: r.type_action,
      commentaire: r.commentaire,
    }));
  }
}
