import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lot 6.5.A — Forgot password self-service.
 *
 * Crée la table `password_reset_token` qui porte les jetons à usage
 * unique générés par `POST /auth/forgot-password`. Le jeton n'est
 * **jamais** stocké en clair : on persiste son hash SHA-256 (64
 * caractères hex). Le jeton clair n'existe que dans le mail envoyé
 * au user via la queue BullMQ (transit éphémère via Redis, cf.
 * pattern `EmailJobData.secrets` du Lot 6.4.C).
 *
 * Idempotent : `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT
 * EXISTS`. Pas de DELETE physique d'un token utilisé : on garde la
 * trace pour audit/forensics — un cron quotidien
 * (`PasswordResetCleanupCronService`) supprime les tokens dont
 * `date_expiration < now() - 30 jours`.
 */
export class CreerPasswordResetTokens1779200000200
  implements MigrationInterface
{
  name = 'CreerPasswordResetTokens1779200000200';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS "password_reset_token" (
        "id" bigserial PRIMARY KEY,
        "fk_user" bigint NOT NULL,
        "token" varchar(64) NOT NULL,
        "date_expiration" timestamp NOT NULL,
        "utilise" boolean NOT NULL DEFAULT false,
        "date_creation" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "utilisateur_creation" varchar(255) NOT NULL,
        "date_modification" timestamp NULL,
        "utilisateur_modification" varchar(255) NULL,
        CONSTRAINT "fk_password_reset_token_user"
          FOREIGN KEY ("fk_user") REFERENCES "user"("id") ON DELETE CASCADE
      )
    `);

    await q.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "ux_password_reset_token_token"
        ON "password_reset_token" ("token")
    `);
    await q.query(`
      CREATE INDEX IF NOT EXISTS "ix_password_reset_token_user"
        ON "password_reset_token" ("fk_user")
    `);
    await q.query(`
      CREATE INDEX IF NOT EXISTS "ix_password_reset_token_expiration"
        ON "password_reset_token" ("date_expiration")
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "password_reset_token"`);
  }
}
