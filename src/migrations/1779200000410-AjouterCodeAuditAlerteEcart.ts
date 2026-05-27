import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lot 8.5.E — Code audit pour alerte mensuelle écarts réalisé.
 *
 * Convention FR métier (cohérente avec DELEGATION_RAPPEL_J3 du Lot
 * 6.5.B et les autres `*_ENVOYE(E)` du module Notifications). Code
 * seedé idempotemment.
 *
 * Code ajouté :
 *  - ALERTE_ECART_REALISE_ENVOYEE — cron mensuel le 5 à 06:00 ;
 *    calcule les écarts budget vs réalisé du mois M-1 via
 *    AnalyseEcartsService, filtre les niveaux ATTENTION + CRITIQUE
 *    et notifie tous les users avec REALISE.VALIDER via
 *    NotificationsService. 1 ligne audit_log par exécution
 *    (récapitulatif), 1 ligne email_log par destinataire effectif.
 *
 * IMPORTANT : ce code doit rester aligné avec le type union
 * `TypeAction` dans `src/audit/entities/audit-log.entity.ts` (cf.
 * `scripts/check-audit-codes-coherence.js` exécuté en CI).
 */
export class AjouterCodeAuditAlerteEcart1779200000410 implements MigrationInterface {
  name = 'AjouterCodeAuditAlerteEcart1779200000410';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      INSERT INTO "ref_type_action_audit"
        ("code","libelle","description","ordre","est_systeme","est_actif","utilisateur_creation")
      VALUES
        ('ALERTE_ECART_REALISE_ENVOYEE',
         'Alerte écart réalisé envoyée par email',
         'Cron mensuel le 5 à 06:00 — calcule les écarts budget vs réalisé du mois précédent (M-1), filtre les niveaux ATTENTION (>= 5%) et CRITIQUE (>= 10%), et notifie tous les users avec la permission REALISE.VALIDER via NotificationsService. 1 ligne audit_log par exécution (récap : nb destinataires, nb attentions, nb critiques). Lot 8.5.E.',
         300, true, true, 'system (Lot 8.5.E)')
      ON CONFLICT ("code") DO NOTHING
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      `DELETE FROM "ref_type_action_audit" WHERE "code" = 'ALERTE_ECART_REALISE_ENVOYEE'`,
    );
  }
}
