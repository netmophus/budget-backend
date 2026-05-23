import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration Lot 8.1.E (Dette #2) — accorde `USER.LIRE` aux rôles
 * SAISISSEUR et PUBLICATEUR.
 *
 * Contexte : le 23/05/2026, un fix SQL manuel avait été appliqué en
 * local pour débloquer la modale `CreerDocumentModal` (Lot 8.2.B P3)
 * qui appelle `GET /api/v1/users` (gardé par `USER.LIRE`) pour
 * proposer le dropdown signataire. Sans cette permission, Ousmane
 * (SAISISSEUR) ne pouvait pas créer un document. Le fix SQL n'avait
 * jamais été régularisé en migration → bug systémique sur tout
 * environnement re-seedé from scratch.
 *
 * Pattern idempotent `INSERT … WHERE NOT EXISTS` (aligné migration
 * `1779200000300-AjouterPermissionsEtCodesAuditLot81A`) : peut être
 * exécutée plusieurs fois sans casser.
 *
 * Note : à terme un endpoint dédié `/api/v1/users/signataires-eligibles`
 * (plus restrictif que `/users` complet, filtrant les users porteurs
 * de DOCUMENT.SIGNER) serait plus propre. Hors périmètre du Lot 8.1.E
 * (qui régularise l'existant sans modifier le contrat API).
 */
export class AjouterUserLireSaisisseurPublicateur1779200000310 implements MigrationInterface {
  name = 'AjouterUserLireSaisisseurPublicateur1779200000310';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const attributions: Array<{ role: string; permission: string }> = [
      { role: 'SAISISSEUR', permission: 'USER.LIRE' },
      { role: 'PUBLICATEUR', permission: 'USER.LIRE' },
    ];

    for (const { role, permission } of attributions) {
      await queryRunner.query(
        `INSERT INTO "bridge_role_permission" ("fk_role", "fk_permission")
         SELECT
           (SELECT id FROM "ref_role" WHERE code_role = $1),
           (SELECT id FROM "ref_permission" WHERE code_permission = $2)
         WHERE NOT EXISTS (
           SELECT 1 FROM "bridge_role_permission"
           WHERE fk_role = (SELECT id FROM "ref_role" WHERE code_role = $1)
             AND fk_permission = (SELECT id FROM "ref_permission" WHERE code_permission = $2)
         )`,
        [role, permission],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "bridge_role_permission" brp
        USING "ref_role" r, "ref_permission" p
       WHERE brp.fk_role = r.id
         AND brp.fk_permission = p.id
         AND r.code_role IN ('SAISISSEUR', 'PUBLICATEUR')
         AND p.code_permission = 'USER.LIRE'`,
    );
  }
}
