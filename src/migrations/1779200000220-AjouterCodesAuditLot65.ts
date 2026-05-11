import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lot 6.5 — Codes audit pour notifications résiduelles.
 *
 * Convention FR métier (cohérente avec RESET_PASSWORD_USER du Lot
 * Administration et CREER_DELEGATION / EXPIRER_DELEGATION du Lot
 * 4.2). Les codes sont seedés idempotemment.
 *
 * Codes ajoutés :
 *  - DEMANDE_RESET_MDP_USER       — POST /auth/forgot-password
 *                                   sur email connu (Lot 6.5.A).
 *  - DEMANDE_RESET_MDP_INCONNU    — POST /auth/forgot-password sur
 *                                   email inconnu / user inactif
 *                                   (anti-énumération, Lot 6.5.A).
 *  - RESET_MDP_USER_VALIDE        — POST /auth/reset-password réussi,
 *                                   mdp changé via lien email
 *                                   (Lot 6.5.A).
 *  - NETTOYAGE_RESET_TOKENS       — cron quotidien 03:00, suppression
 *                                   tokens expirés > 30 jours
 *                                   (Lot 6.5.A).
 *  - DELEGATION_RAPPEL_J3         — cron quotidien 06:00, notification
 *                                   J-3 délégation (Lot 6.5.B).
 *
 * IMPORTANT : ces codes doivent rester alignés avec le type union
 * `TypeAction` dans `src/audit/entities/audit-log.entity.ts` (cf.
 * `scripts/check-audit-codes-coherence.js` exécuté en CI).
 */
export class AjouterCodesAuditLot651779200000220 implements MigrationInterface {
  name = 'AjouterCodesAuditLot651779200000220';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      INSERT INTO "ref_type_action_audit"
        ("code","libelle","description","ordre","est_systeme","est_actif","utilisateur_creation")
      VALUES
        ('DEMANDE_RESET_MDP_USER',
         'Demande de réinitialisation de mot de passe (email connu)',
         'Un utilisateur a demandé un lien de réinitialisation via POST /auth/forgot-password ; l''email correspond à un compte actif. Token généré + email envoyé. Lot 6.5.A.',
         150, true, true, 'system (Lot 6.5)'),
        ('DEMANDE_RESET_MDP_INCONNU',
         'Demande de réinitialisation de mot de passe (email inconnu)',
         'Tentative de POST /auth/forgot-password avec un email inconnu ou un user inactif. Aucun token généré, aucun email envoyé. Trace conservée pour détection de scan d''emails. Lot 6.5.A.',
         151, true, true, 'system (Lot 6.5)'),
        ('RESET_MDP_USER_VALIDE',
         'Réinitialisation de mot de passe self-service réussie',
         'Un utilisateur a validé un lien de réinitialisation via POST /auth/reset-password. Token marqué utilisé, mot de passe changé. Lot 6.5.A.',
         152, true, true, 'system (Lot 6.5)'),
        ('NETTOYAGE_RESET_TOKENS',
         'Nettoyage automatique des tokens reset expirés',
         'Cron quotidien à 03:00 — supprime les password_reset_token dont date_expiration est antérieure à now() - 30 jours. Lot 6.5.A.',
         153, true, true, 'system (Lot 6.5)'),
        ('DELEGATION_RAPPEL_J3',
         'Rappel J-3 expiration délégation',
         'Cron quotidien à 06:00 — notifie le délégant et le délégataire qu''une délégation expire dans 3 jours. Lot 6.5.B.',
         154, true, true, 'system (Lot 6.5)')
      ON CONFLICT ("code") DO NOTHING
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      `DELETE FROM "ref_type_action_audit" WHERE "code" IN (
        'DEMANDE_RESET_MDP_USER',
        'DEMANDE_RESET_MDP_INCONNU',
        'RESET_MDP_USER_VALIDE',
        'NETTOYAGE_RESET_TOKENS',
        'DELEGATION_RAPPEL_J3'
      )`,
    );
  }
}
