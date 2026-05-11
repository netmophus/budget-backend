import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lot 6.5.B — Notification J-3 délégation.
 *
 * Ajoute la colonne `derniere_notification_j3` (timestamp NULL) à
 * `delegations` pour idempotencer le cron quotidien : une délégation
 * dont le rappel J-3 a déjà été envoyé n'est pas re-notifiée si le
 * cron tourne plusieurs fois le même jour (ex : redémarrage app).
 *
 * Idempotente : check via information_schema avant ALTER (pattern
 * Lot 6.4.A migration 180).
 */
export class AjouterNotificationJ3Delegations1779200000210 implements MigrationInterface {
  name = 'AjouterNotificationJ3Delegations1779200000210';

  public async up(q: QueryRunner): Promise<void> {
    const colExist = (await q.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_name = 'delegations'
          AND column_name = 'derniere_notification_j3'`,
    )) as Array<unknown>;
    if (colExist.length === 0) {
      await q.query(
        `ALTER TABLE "delegations"
           ADD COLUMN "derniere_notification_j3" timestamp NULL`,
      );
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE "delegations" DROP COLUMN IF EXISTS "derniere_notification_j3"`,
    );
  }
}
