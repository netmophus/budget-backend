import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lot 6.3 — Ajout du statut `EN_COURS` à `email_log.statut`.
 *
 * Le statut intermédiaire entre `EN_ATTENTE` (job publié dans la
 * queue BullMQ) et `ENVOYE`/`ECHEC` (terminal) marque le moment où
 * le worker a pris en main le job et tente l'envoi SMTP. Permet de
 * distinguer un email coincé en attente (queue saturée ou Redis
 * down) d'un email en cours de traitement actif.
 *
 * Migration idempotente : DROP IF EXISTS de la contrainte CHECK avant
 * recreation avec la valeur ajoutée.
 */
export class AjoutStatutEnCoursEmailLog1779200000170
  implements MigrationInterface
{
  name = 'AjoutStatutEnCoursEmailLog1779200000170';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE "email_log" DROP CONSTRAINT IF EXISTS "chk_email_log_statut"`,
    );
    await q.query(
      `ALTER TABLE "email_log" ADD CONSTRAINT "chk_email_log_statut"
         CHECK ("statut" IN ('EN_ATTENTE','EN_COURS','ENVOYE','ECHEC','SUPPRIME'))`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    // Avant de revenir à l'ancienne contrainte, repasser les lignes
    // potentielles en EN_COURS vers EN_ATTENTE pour ne pas violer
    // la contrainte historique.
    await q.query(
      `UPDATE "email_log" SET "statut" = 'EN_ATTENTE' WHERE "statut" = 'EN_COURS'`,
    );
    await q.query(
      `ALTER TABLE "email_log" DROP CONSTRAINT IF EXISTS "chk_email_log_statut"`,
    );
    await q.query(
      `ALTER TABLE "email_log" ADD CONSTRAINT "chk_email_log_statut"
         CHECK ("statut" IN ('EN_ATTENTE','ENVOYE','ECHEC','SUPPRIME'))`,
    );
  }
}
