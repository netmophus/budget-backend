import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lots 3.5 / 3.6 / 3.7 — Ajout des 6 codes `type_action` manquants
 * dans `ref_type_action_audit`. Sans ces lignes, tout INSERT dans
 * `audit_log` avec ces nouveaux types plante sur la FK
 * `fk_audit_log_type_action` posée par 1779100000130.
 *
 * Codes ajoutés :
 *  - SOUMETTRE_BUDGET     (Lot 3.5)
 *  - VALIDER_BUDGET       (Lot 3.5)
 *  - REJETER_BUDGET       (Lot 3.5)
 *  - PUBLIER_BUDGET       (Lot 3.5)
 *  - RECALCUL_INDICATEURS (Lot 3.6)
 *  - IMPORT_BUDGET_BULK   (Lot 3.7)
 *
 * Idempotent via `ON CONFLICT (code) DO NOTHING`.
 */
export class AddRefTypeActionWorkflowAndIndicateurs1779200000060 implements MigrationInterface {
  name = 'AddRefTypeActionWorkflowAndIndicateurs1779200000060';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      INSERT INTO "ref_type_action_audit"
        ("code", "libelle", "description", "ordre", "est_systeme",
         "est_actif", "utilisateur_creation")
      VALUES
        ('SOUMETTRE_BUDGET',
         'Soumettre une version à validation',
         'Le préparateur soumet une version Brouillon (statut: ouvert → soumis). ' ||
         'Permission BUDGET.SOUMETTRE (Lot 3.5).',
         100, true, true, 'system'),
        ('VALIDER_BUDGET',
         'Valider une version soumise',
         'Le contrôleur valide une version (statut: soumis → valide). ' ||
         'Permission BUDGET.VALIDER (Lot 3.5).',
         110, true, true, 'system'),
        ('REJETER_BUDGET',
         'Rejeter une version soumise',
         'Le contrôleur rejette une version (statut: soumis → ouvert) avec ' ||
         'commentaire obligatoire. Permission BUDGET.VALIDER (Lot 3.5).',
         120, true, true, 'system'),
        ('PUBLIER_BUDGET',
         'Publier (geler) une version validée',
         'Le directeur publie une version (statut: valide → gele). ' ||
         'Action irréversible, conservation 10 ans BCEAO. Permission ' ||
         'BUDGET.PUBLIER (Lot 3.5).',
         130, true, true, 'system'),
        ('RECALCUL_INDICATEURS',
         'Rafraîchissement des indicateurs',
         'Refresh manuel de mv_indicateurs_budget via POST ' ||
         '/budget/indicateurs/refresh. Permission BUDGET.LIRE (Lot 3.6).',
         140, true, true, 'system'),
        ('IMPORT_BUDGET_BULK',
         'Import en masse depuis fichier CSV/XLSX',
         'Import multi-lignes de saisie budgétaire (POST /budget/import). ' ||
         'Une seule entrée audit_log par appel avec rapport agrégé. ' ||
         'Permission BUDGET.SAISIR (Lot 3.7).',
         150, true, true, 'system')
      ON CONFLICT ("code") DO NOTHING
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`
      DELETE FROM "ref_type_action_audit"
       WHERE "code" IN (
         'SOUMETTRE_BUDGET', 'VALIDER_BUDGET', 'REJETER_BUDGET',
         'PUBLIER_BUDGET', 'RECALCUL_INDICATEURS', 'IMPORT_BUDGET_BULK'
       )
    `);
  }
}
