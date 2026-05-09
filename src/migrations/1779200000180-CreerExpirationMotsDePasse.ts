import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lot 6.4.A — Sécurisation des mots de passe : expiration + force change.
 *
 * Ajoute 2 colonnes à `"user"` :
 *  - `date_expiration_mdp` (timestamp NULL) : date à partir de
 *    laquelle le mdp expire. NULL = pas d'expiration (cas des
 *    users créés avant le Lot 6.4 — dette assumée pour MVP, à
 *    backfiller manuellement post-MEP).
 *  - `doit_changer_mdp` (boolean NOT NULL DEFAULT false) : flag
 *    forcé par admin lors d'un reset password (Lot 6.4.C). Tant
 *    que vrai, le user peut se connecter mais TOUTES les autres
 *    requêtes API sont bloquées (403 MDP_TEMPORAIRE) sauf
 *    PATCH /me/password.
 *
 * Idempotent : check via information_schema pour ne pas re-ajouter
 * les colonnes (pattern Lot 4.3 / migration 130).
 */
export class CreerExpirationMotsDePasse1779200000180
  implements MigrationInterface
{
  name = 'CreerExpirationMotsDePasse1779200000180';

  public async up(q: QueryRunner): Promise<void> {
    const colExpiration = (await q.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_name = 'user'
          AND column_name = 'date_expiration_mdp'`,
    )) as Array<unknown>;
    if (colExpiration.length === 0) {
      await q.query(
        `ALTER TABLE "user"
           ADD COLUMN "date_expiration_mdp" timestamp NULL`,
      );
    }

    const colDoit = (await q.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_name = 'user'
          AND column_name = 'doit_changer_mdp'`,
    )) as Array<unknown>;
    if (colDoit.length === 0) {
      await q.query(
        `ALTER TABLE "user"
           ADD COLUMN "doit_changer_mdp" boolean NOT NULL DEFAULT false`,
      );
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE "user" DROP COLUMN IF EXISTS "doit_changer_mdp"`,
    );
    await q.query(
      `ALTER TABLE "user" DROP COLUMN IF EXISTS "date_expiration_mdp"`,
    );
  }
}
