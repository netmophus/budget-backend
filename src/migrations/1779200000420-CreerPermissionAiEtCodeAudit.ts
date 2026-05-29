import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration Lot 8.6.A — MIZNAS AI Analyse Budget vs Réalisé.
 *
 * Ajoute le code audit `AI_ANALYSE_DEMANDEE`, la permission
 * `AI.ANALYSER` et l'attribution au rôle ADMIN. Pattern identique
 * à AjouterPermissionsRealiseADMIN (Lot 8.5.B) + AjouterCodeAuditAlerteEcart
 * (Lot 8.5.E). Tous les INSERT sont idempotents (ON CONFLICT DO NOTHING).
 *
 * Détail :
 *  - `ref_type_action_audit` : 1 nouveau code `AI_ANALYSE_DEMANDEE`
 *    (1 ligne audit_log par appel à POST /tableau-de-bord/analyse-ai,
 *    contenant le payload récap : filtres + tokens + durée + modèle).
 *  - `ref_permission` : 1 nouvelle permission `AI.ANALYSER` (module
 *    `AI`), gardée par @RequirePermissions sur l'endpoint.
 *  - `bridge_role_permission` : attribution à ADMIN par défaut.
 *
 * IMPORTANT — Le code `AI_ANALYSE_DEMANDEE` doit rester aligné avec
 * le type union `TypeAction` dans `audit-log.entity.ts` (vérifié par
 * `scripts/check-audit-codes-coherence.js` en CI).
 */
interface RoleRow {
  id: string;
}

export class CreerPermissionAiEtCodeAudit1779200000420 implements MigrationInterface {
  name = 'CreerPermissionAiEtCodeAudit1779200000420';

  public async up(q: QueryRunner): Promise<void> {
    // ─── 1. Code audit AI_ANALYSE_DEMANDEE ─────────────────────────
    await q.query(`
      INSERT INTO "ref_type_action_audit"
        ("code","libelle","description","ordre","est_systeme","est_actif","utilisateur_creation")
      VALUES
        ('AI_ANALYSE_DEMANDEE',
         'Analyse MIZNAS AI demandée',
         'Un utilisateur a déclenché une analyse IA du dashboard Budget vs Réalisé via POST /tableau-de-bord/analyse-ai. La ligne audit_log contient le récapitulatif (filtres analysés, modèle, tokens input/output, durée totale). Le prompt complet et la réponse ne sont PAS persistés (volatile côté client). Lot 8.6.A.',
         310, true, true, 'system (Lot 8.6.A)')
      ON CONFLICT ("code") DO NOTHING
    `);

    // ─── 2. Permission AI.ANALYSER ─────────────────────────────────
    await q.query(`
      INSERT INTO "ref_permission" ("code_permission","libelle","description","module","utilisateur_creation")
      VALUES
        ('AI.ANALYSER',
         'Demander une analyse MIZNAS AI',
         'Déclencher une analyse IA du dashboard Budget vs Réalisé. Inclut la lecture des écarts (déjà gardée par BUDGET.LIRE + REALISE.LIRE sur l''endpoint Lot 5.2). Rate-limité côté service (3 / minute + 10 / jour par utilisateur). Lot 8.6.A.',
         'AI','system (Lot 8.6.A)')
      ON CONFLICT ("code_permission") DO NOTHING
    `);

    // ─── 3. Attribution AI.ANALYSER au rôle ADMIN ──────────────────
    const adminRows = (await q.query(
      `SELECT id FROM ref_role WHERE code_role = 'ADMIN' LIMIT 1`,
    )) as RoleRow[];
    if (adminRows.length === 0) {
      console.warn(
        "[Migration 8.6.A] Rôle 'ADMIN' introuvable — attribution AI.ANALYSER skip.",
      );
      return;
    }
    const adminRoleId = String(adminRows[0]!.id);

    await q.query(
      `INSERT INTO bridge_role_permission (fk_role, fk_permission)
       SELECT $1::bigint, p.id FROM ref_permission p
       WHERE p.code_permission = 'AI.ANALYSER'
       ON CONFLICT (fk_role, fk_permission) DO NOTHING`,
      [adminRoleId],
    );
    console.log(
      '[Migration 8.6.A] Code audit AI_ANALYSE_DEMANDEE + permission AI.ANALYSER ' +
        'créés. Attribution ADMIN : OK (idempotent).',
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      `DELETE FROM bridge_role_permission
       WHERE fk_permission IN (
         SELECT id FROM ref_permission WHERE code_permission = 'AI.ANALYSER'
       )`,
    );
    await q.query(
      `DELETE FROM ref_permission WHERE code_permission = 'AI.ANALYSER'`,
    );
    await q.query(
      `DELETE FROM ref_type_action_audit WHERE code = 'AI_ANALYSE_DEMANDEE'`,
    );
  }
}
