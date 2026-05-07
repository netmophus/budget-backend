import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lot 4.1-fix2 — 3 correctifs data regroupés en une seule
 * migration idempotente (commodité opérateur, splittable au besoin) :
 *
 *  - **B** : ajout des 5 codes type_action manquants
 *    (CREER_AFFECTATION, RETIRER_AFFECTATION, et anticipation
 *    Lot 4.2 : CREER_DELEGATION, REVOQUER_DELEGATION,
 *    EXPIRER_DELEGATION). Sans ces lignes, les INSERT dans
 *    audit_log plantent sur la FK fk_audit_log_type_action.
 *
 *  - **C** : index unique fonctionnel sur le contenu trié des
 *    `cible_cr_ids` pour les CR_SET actifs. Empêche un même user
 *    de créer N fois exactement le même ensemble de CR (ordre
 *    indifférent grâce à `array(SELECT unnest ORDER BY)`).
 *
 *  - **D** : volontairement vide ici — l'inventaire de ref_role
 *    a montré que seuls ADMIN et LECTEUR existent ; le mandat
 *    interdit la création de nouveaux rôles dans ce fix. Re-seed
 *    différencié reporté à un lot Administration dédié avant le
 *    Lot 5.
 *
 * Tous les INSERT sont en `ON CONFLICT (...) DO NOTHING` ; la
 * création d'index utilise `IF NOT EXISTS`.
 */
export class Lot41Fix2DataPatches1779200000100 implements MigrationInterface {
  name = 'Lot41Fix2DataPatches1779200000100';

  public async up(q: QueryRunner): Promise<void> {
    // ─── B. Codes type_action manquants ─────────────────────────────
    await q.query(`
      INSERT INTO "ref_type_action_audit"
        ("code", "libelle", "description", "ordre", "est_systeme",
         "est_actif", "utilisateur_creation")
      VALUES
        ('CREER_AFFECTATION',
         'Créer une affectation périmètre',
         'Création d''une ligne user_perimetres (affectation explicite). Lot 4.1.',
         110, true, true, 'system (Lot 4.1-fix2)'),
        ('RETIRER_AFFECTATION',
         'Retirer une affectation périmètre',
         'Désactivation soft (actif=false) d''une ligne user_perimetres. Lot 4.1.',
         111, true, true, 'system (Lot 4.1-fix2)'),
        ('CREER_DELEGATION',
         'Créer une délégation',
         'Délégation temporaire de périmètre — anticipation Lot 4.2.',
         120, true, true, 'system (Lot 4.1-fix2 / anticipation 4.2)'),
        ('REVOQUER_DELEGATION',
         'Révoquer une délégation',
         'Révocation manuelle d''une délégation — anticipation Lot 4.2.',
         121, true, true, 'system (Lot 4.1-fix2 / anticipation 4.2)'),
        ('EXPIRER_DELEGATION',
         'Expirer une délégation (auto)',
         'Expiration automatique d''une délégation — anticipation Lot 4.2.',
         122, true, true, 'system (Lot 4.1-fix2 / anticipation 4.2)')
      ON CONFLICT ("code") DO NOTHING
    `);

    // ─── C. Index unique anti-doublons CR_SET ───────────────────────
    //
    // Postgres exige une fonction IMMUTABLE pour pouvoir indexer une
    // expression. La fonction `_cr_set_normalize` retourne le tableau
    // trié ASC (de sorte que {13,14} et {14,13} produisent la même
    // valeur indexable). On la crée idempotente via
    // CREATE OR REPLACE FUNCTION.
    await q.query(`
      CREATE OR REPLACE FUNCTION "_cr_set_normalize"(arr bigint[])
      RETURNS bigint[]
      LANGUAGE sql
      IMMUTABLE
      AS $$ SELECT array(SELECT unnest($1) ORDER BY 1) $$
    `);

    await q.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_user_perimetres_cr_set_actif"
        ON "user_perimetres"
        ("fk_user", _cr_set_normalize("cible_cr_ids"))
        WHERE "actif" = true AND "cible_type" = 'CR_SET'
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS "uq_user_perimetres_cr_set_actif"`);
    await q.query(`DROP FUNCTION IF EXISTS "_cr_set_normalize"(bigint[])`);
    await q.query(`
      DELETE FROM "ref_type_action_audit"
       WHERE "code" IN (
         'CREER_AFFECTATION', 'RETIRER_AFFECTATION',
         'CREER_DELEGATION', 'REVOQUER_DELEGATION', 'EXPIRER_DELEGATION'
       )
    `);
  }
}
