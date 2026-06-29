import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * PR A — Gestion de la matrice rôle × permission depuis l'UI admin
 * (permission ROLE.GERER, déjà seedée et portée par ADMIN).
 *
 * Ajoute 2 codes audit dans `ref_type_action_audit` :
 *  - ATTRIBUER_PERMISSION : INSERT bridge_role_permission (idempotent).
 *  - RETIRER_PERMISSION   : DELETE bridge_role_permission, sous
 *    garde-fous (permissions verrouillées sur ADMIN + anti-lockout
 *    ROLE.GERER).
 *
 * Aucun changement de schéma : `bridge_role_permission` existe déjà
 * (table de jointure, FK ON DELETE CASCADE, UNIQUE (fk_role, fk_permission)).
 *
 * Idempotente (ON CONFLICT (code) DO NOTHING) et réversible (down).
 */
export class AjouterCodesAuditGestionMatriceRolePermission1779200000580 implements MigrationInterface {
  name = 'AjouterCodesAuditGestionMatriceRolePermission1779200000580';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      INSERT INTO "ref_type_action_audit"
        ("code","libelle","description","ordre","est_systeme","est_actif","utilisateur_creation")
      VALUES
        ('ATTRIBUER_PERMISSION',
         'Attribuer une permission à un rôle',
         'INSERT bridge_role_permission via l''UI admin (ROLE.GERER). Idempotent : aucun audit si le lien existe déjà. PR A.',
         630, true, true, 'migration 580'),
        ('RETIRER_PERMISSION',
         'Retirer une permission d''un rôle',
         'DELETE bridge_role_permission via l''UI admin (ROLE.GERER). Garde-fous : permissions verrouillées sur ADMIN (SYSTEM.ADMIN, ROLE.GERER, USER.GERER) + anti-lockout ROLE.GERER. PR A.',
         631, true, true, 'migration 580')
      ON CONFLICT ("code") DO NOTHING
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`
      DELETE FROM "ref_type_action_audit"
       WHERE "code" IN ('ATTRIBUER_PERMISSION','RETIRER_PERMISSION')
    `);
  }
}
