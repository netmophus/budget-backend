import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration Lot 8.6.B — Export PDF Analyse Budget vs Réalisé.
 *
 * Ajoute le code audit `EXPORT_PDF_TABLEAU_BORD` à
 * `ref_type_action_audit`. Cohérent avec les codes existants
 * `EXPORT_R04_PDF` / `EXPORT_R04_XLSX` du Lot 7.6 (convention
 * verbe-cible-format).
 *
 * Pas de nouvelle permission : l'endpoint POST /tableau-de-bord/
 * export-pdf réutilise BUDGET.LIRE + REALISE.LIRE déjà attribuées
 * (mêmes que GET /budget-vs-realise du Lot 5.2).
 *
 * IMPORTANT — Le code doit rester aligné avec le type union
 * `TypeAction` dans `audit-log.entity.ts` (vérifié par
 * `scripts/check-audit-codes-coherence.js` en CI).
 */
export class AjouterCodeAuditExportPdfTableauBord1779200000430 implements MigrationInterface {
  name = 'AjouterCodeAuditExportPdfTableauBord1779200000430';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      INSERT INTO "ref_type_action_audit"
        ("code","libelle","description","ordre","est_systeme","est_actif","utilisateur_creation")
      VALUES
        ('EXPORT_PDF_TABLEAU_BORD',
         'Export PDF du tableau de bord Budget vs Réalisé',
         'Un utilisateur a exporté le dashboard Budget vs Réalisé en PDF via POST /tableau-de-bord/export-pdf. La ligne audit_log contient le récapitulatif (codeVersion, codeScenario, période, nbLignesAnalysees, avecAnalyseIa, modeleIa éventuel, tailleOctets, dureeMs). Le contenu du PDF n''est PAS persisté (streaming direct). Lot 8.6.B.',
         320, true, true, 'system (Lot 8.6.B)')
      ON CONFLICT ("code") DO NOTHING
    `);
    console.log(
      '[Migration 8.6.B] Code audit EXPORT_PDF_TABLEAU_BORD créé (idempotent).',
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      `DELETE FROM "ref_type_action_audit" WHERE "code" = 'EXPORT_PDF_TABLEAU_BORD'`,
    );
  }
}
