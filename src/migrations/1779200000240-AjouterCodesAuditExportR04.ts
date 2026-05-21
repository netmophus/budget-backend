import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lot 7.6 — 2 codes audit pour le rapport R04 "Budget Publié BCEAO".
 *
 * Ajoute :
 *  - EXPORT_R04_PDF  : téléchargement du PDF officiel 12 pages
 *  - EXPORT_R04_XLSX : téléchargement du XLSX exploitable 5 onglets
 *
 * Permission requise côté contrôleur : BUDGET.LIRE.
 *
 * Idempotent : ON CONFLICT (code) DO NOTHING.
 */
export class AjouterCodesAuditExportR041779200000240 implements MigrationInterface {
  name = 'AjouterCodesAuditExportR041779200000240';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      INSERT INTO "ref_type_action_audit"
        ("code", "libelle", "description", "ordre", "est_systeme",
         "est_actif", "utilisateur_creation")
      VALUES
        ('EXPORT_R04_PDF',
         'Export R04 — PDF',
         'Téléchargement du rapport R04 "Budget Publié BCEAO" au format PDF officiel (12 pages, charte BSIC). Permission BUDGET.LIRE. Lot 7.6.',
         300, true, true, 'system (Lot 7.6)'),
        ('EXPORT_R04_XLSX',
         'Export R04 — Excel',
         'Téléchargement du rapport R04 "Budget Publié BCEAO" au format XLSX exploitable (5 onglets : Synthèse, Compte de résultat, Par CR, Détail comptes, Audit trail). Permission BUDGET.LIRE. Lot 7.6.',
         301, true, true, 'system (Lot 7.6)')
      ON CONFLICT ("code") DO NOTHING
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`
      DELETE FROM "ref_type_action_audit"
       WHERE "code" IN ('EXPORT_R04_PDF', 'EXPORT_R04_XLSX')
    `);
  }
}
