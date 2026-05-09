import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lot 6.4 — Codes audit liés à la sécurisation des mots de passe.
 *
 * Convention : alignement EN/UPPERCASE sur les codes auth existants
 * (LOGIN, LOGIN_FAILED, REFRESH, LOGOUT, RESET_PASSWORD_USER) plutôt
 * que la convention FR verbe-sujet du domaine métier (qui s'applique
 * à BUDGET / REALISE / REFORECAST). Cohérence locale > convention
 * globale ici — décision actée au démarrage du Lot 6.4.
 *
 * Codes ajoutés :
 *  - PASSWORD_CHANGED (Lot 6.4.A) : user a changé son mdp via
 *    PATCH /me/password (volontaire ou forcé après expiration).
 *  - LOGIN_RATE_LIMITED (Lot 6.4.B, anticipation) : tentative de
 *    login bloquée par @nestjs/throttler. Seedé ici pour éviter
 *    une migration supplémentaire au palier B.
 *
 * IMPORTANT : ces codes doivent rester alignés avec le type union
 * `TypeAction` dans `src/audit/entities/audit-log.entity.ts`,
 * sinon `tsc --noEmit` casse (cf. dette TS2322 Lot Administration).
 */
export class AjouterCodesAuditPasswordSecurity1779200000190
  implements MigrationInterface
{
  name = 'AjouterCodesAuditPasswordSecurity1779200000190';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      INSERT INTO "ref_type_action_audit"
        ("code","libelle","description","ordre","est_systeme","est_actif","utilisateur_creation")
      VALUES
        ('PASSWORD_CHANGED',
         'Changement de mot de passe',
         'L''utilisateur a changé son mot de passe via PATCH /me/password (volontaire ou forcé après expiration / reset admin). Lot 6.4.A.',
         140, true, true, 'system (Lot 6.4)'),
        ('LOGIN_RATE_LIMITED',
         'Tentative de connexion bloquée (rate limit)',
         'Tentative de POST /auth/login bloquée par le throttler après dépassement de la limite (5 tentatives/min/IP ou 5/15min/email). Lot 6.4.B.',
         141, true, true, 'system (Lot 6.4)')
      ON CONFLICT ("code") DO NOTHING
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      `DELETE FROM "ref_type_action_audit"
        WHERE "code" IN ('PASSWORD_CHANGED','LOGIN_RATE_LIMITED')`,
    );
  }
}
