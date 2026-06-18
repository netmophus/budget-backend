import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lot workflow par CR — Rôle COORDINATEUR + permission BUDGET.COORDONNER.
 *
 * Le Coordinateur déclenche manuellement la soumission au Comité d'une
 * version PRE_VALIDE. Tous les INSERT sont idempotents (ON CONFLICT
 * DO NOTHING). L'affectation du rôle à un utilisateur (Ousmane MAMANE)
 * reste une action ADMIN manuelle, hors migration.
 */
interface IdRow {
  id: string;
}

export class AjouterRoleCoordinateurEtPermission1779200000480 implements MigrationInterface {
  name = 'AjouterRoleCoordinateurEtPermission1779200000480';

  public async up(q: QueryRunner): Promise<void> {
    // 1. Permission BUDGET.COORDONNER (module BUDGET).
    await q.query(`
      INSERT INTO "ref_permission"
        ("code_permission","libelle","description","module","utilisateur_creation")
      VALUES
        ('BUDGET.COORDONNER',
         'Coordonner le cycle budgétaire',
         'Déclencher la soumission au Comité d''une version pré-validée (tous les CR attendus validés). Workflow de validation par CR.',
         'BUDGET','system (Lot workflow CR)')
      ON CONFLICT ("code_permission") DO NOTHING
    `);

    // 2. Rôle COORDINATEUR.
    await q.query(`
      INSERT INTO "ref_role"
        ("code_role","libelle","description","est_actif","utilisateur_creation")
      VALUES
        ('COORDINATEUR',
         'Coordinateur budgétaire',
         'Pilote le cycle de validation par CR et déclenche la soumission de la version au Comité une fois tous les CR validés.',
         true,'system (Lot workflow CR)')
      ON CONFLICT ("code_role") DO NOTHING
    `);

    // 3. Bridge COORDINATEUR ← { BUDGET.LIRE, BUDGET.COORDONNER }.
    const roleRows = (await q.query(
      `SELECT id FROM ref_role WHERE code_role = 'COORDINATEUR' LIMIT 1`,
    )) as IdRow[];
    if (roleRows.length === 0) return;
    const roleId = String(roleRows[0]!.id);
    for (const perm of ['BUDGET.LIRE', 'BUDGET.COORDONNER']) {
      await q.query(
        `INSERT INTO bridge_role_permission (fk_role, fk_permission)
         SELECT $1::bigint, p.id FROM ref_permission p
         WHERE p.code_permission = $2
         ON CONFLICT (fk_role, fk_permission) DO NOTHING`,
        [roleId, perm],
      );
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`
      DELETE FROM bridge_role_permission
       WHERE fk_role IN (SELECT id FROM ref_role WHERE code_role = 'COORDINATEUR')
    `);
    await q.query(`DELETE FROM ref_role WHERE code_role = 'COORDINATEUR'`);
    await q.query(`
      DELETE FROM bridge_role_permission
       WHERE fk_permission IN (
         SELECT id FROM ref_permission WHERE code_permission = 'BUDGET.COORDONNER'
       )
    `);
    await q.query(
      `DELETE FROM ref_permission WHERE code_permission = 'BUDGET.COORDONNER'`,
    );
  }
}
