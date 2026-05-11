import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lot 3.3 — Ajout du code `IMPORT_BUDGET` dans `ref_type_action_audit`
 * pour permettre à `audit_log.type_action` (FK Lot 2.5-bis) de tracer
 * les saisies budgétaires en lot via la grille.
 *
 * Idempotent via ON CONFLICT.
 */
export class AddRefTypeActionImportBudget1779200000030 implements MigrationInterface {
  name = 'AddRefTypeActionImportBudget1779200000030';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      INSERT INTO "ref_type_action_audit"
        ("code", "libelle", "description", "ordre", "est_systeme",
         "est_actif", "utilisateur_creation")
      VALUES
        ('IMPORT_BUDGET',
         'Saisie budgétaire en lot',
         'Saisie en lot de cellules fait_budget via la grille (Lot 3.3). ' ||
         'Une seule entrée audit_log par appel POST /fait-budget/grille, ' ||
         'avec rapport global (totalCellules, inserees, modifiees, supprimees).',
         42, true, true, 'system')
      ON CONFLICT ("code") DO NOTHING
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      `DELETE FROM "ref_type_action_audit" WHERE "code" = 'IMPORT_BUDGET'`,
    );
  }
}
