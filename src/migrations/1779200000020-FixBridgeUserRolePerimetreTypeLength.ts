import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lot 3.3 — Correction socle Lot 1.
 *
 * Bug détecté lors de l'implémentation du PerimetreService :
 * `bridge_user_role.perimetre_type` était déclarée `varchar(20)` mais
 * le CHECK constraint accepte `'centre_responsabilite'` qui fait
 * **21 caractères** — impossible à insérer en pratique.
 *
 * Cette migration étend la colonne à `varchar(50)`, sans toucher au
 * CHECK ni au seed (les valeurs existantes 'global' / 'structure'
 * tiennent toujours). Non-cassant, additive uniquement.
 *
 * Cf. `docs/modele-donnees.md` §4.4 et le rapport Lot 3.3.
 */
export class FixBridgeUserRolePerimetreTypeLength1779200000020 implements MigrationInterface {
  name = 'FixBridgeUserRolePerimetreTypeLength1779200000020';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE "bridge_user_role"
         ALTER COLUMN "perimetre_type" TYPE varchar(50)`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    // ⚠ Revert dangereux : si une ligne contient 'centre_responsabilite'
    //   (21 chars), le ALTER échouera. C'est intentionnel — on ne
    //   doit pas réintroduire le bug en production.
    await q.query(
      `ALTER TABLE "bridge_user_role"
         ALTER COLUMN "perimetre_type" TYPE varchar(20)`,
    );
  }
}
