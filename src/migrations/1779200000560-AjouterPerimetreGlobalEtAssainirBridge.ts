import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Gouvernance des accès — type de périmètre `GLOBAL` first-class +
 * assainissement de `bridge_user_role.perimetre_type`.
 *
 * Contexte (état des lieux juin 2026) : le dropdown CR de tous les
 * écrans de saisie/filtrage passe par `resoudreCrAccessibles` qui ne
 * bypasse que la permission `SYSTEM.ADMIN`. Tout utilisateur global
 * SANS `user_perimetres` et non-ADMIN (DG, Président Comité) obtenait
 * une liste de CR VIDE, alors qu'il doit tout voir.
 *
 * Cette migration :
 *  1. Ajoute le `cible_type = 'GLOBAL'` (CHECK type + cohérence : ni
 *     cible_id ni cible_cr_ids) + unicité d'1 GLOBAL actif par user.
 *     La résolution de périmètre (PerimetreService.getCrAutorisesPourUser
 *     → null ; UserPerimetreService.resoudreCrAccessibles → tous les CR)
 *     honore GLOBAL : c'est le code qui matérialise le « voit tout ».
 *  2. Insère une affectation GLOBAL pour les 4 utilisateurs de
 *     gouvernance : DG, Président Comité, et 2 membres Comité. GLOBAL
 *     domine l'union → leurs CR_SET validateur éventuels sont conservés
 *     (documentation du scope nominal) mais n'ont plus d'effet restrictif.
 *  3. Assainit `bridge_user_role.perimetre_type` : il valait 'global'
 *     pour TOUT le monde (faux). On le repasse à 'centre_responsabilite'
 *     pour les rôles terrain (SAISISSEUR/VALIDATEUR) UNIQUEMENT quand le
 *     user a déjà un périmètre explicite dans user_perimetres — sinon le
 *     fallback bridge resterait leur seule source d'accès (on ne casse
 *     donc aucun persona global sans périmètre, ex. e2e). Les rôles à
 *     portée globale (ADMIN/PUBLICATEUR/COORDINATEUR/AUDITEUR/LECTEUR)
 *     restent 'global'.
 *
 * Idempotente : inserts gardés par NOT EXISTS, updates gardés par
 * conditions ; rejouable sans effet de bord. Sûre hors environnement
 * BSIC (les 4 emails ciblés n'existent pas → inserts no-op).
 */
export class AjouterPerimetreGlobalEtAssainirBridge1779200000560 implements MigrationInterface {
  name = 'AjouterPerimetreGlobalEtAssainirBridge1779200000560';

  /** Emails des utilisateurs de gouvernance recevant un périmètre GLOBAL. */
  private static readonly GLOBAL_EMAILS = [
    'issoufou.barry@bsic.ne', // DG (PUBLICATEUR)
    'souleymane.diori@bsic.ne', // Président Comité (VALIDATEUR)
    'halima.ousmane@bsic.ne', // Membre Comité (VALIDATEUR)
    'ibrahima.mahamadou@bsic.ne', // Membre Comité (VALIDATEUR)
  ];

  private static readonly MOTIF_GLOBAL =
    'Gouvernance — périmètre GLOBAL (migration 560)';
  private static readonly MARQUEUR_BRIDGE = 'migration-560-assainissement';

  public async up(q: QueryRunner): Promise<void> {
    // 1. CHECK cible_type : ajoute 'GLOBAL'.
    await q.query(`
      ALTER TABLE "user_perimetres"
        DROP CONSTRAINT IF EXISTS "ck_user_perimetres_cible_type"
    `);
    await q.query(`
      ALTER TABLE "user_perimetres"
        ADD CONSTRAINT "ck_user_perimetres_cible_type"
        CHECK ("cible_type" IN ('STRUCTURE','CR','CR_SET','GLOBAL'))
    `);

    // 2. CHECK cohérence : branche GLOBAL (ni cible_id ni cible_cr_ids).
    await q.query(`
      ALTER TABLE "user_perimetres"
        DROP CONSTRAINT IF EXISTS "ck_user_perimetres_cible_coherence"
    `);
    await q.query(`
      ALTER TABLE "user_perimetres"
        ADD CONSTRAINT "ck_user_perimetres_cible_coherence"
        CHECK (
          (
            "cible_type" IN ('STRUCTURE','CR')
            AND "cible_id" IS NOT NULL
            AND "cible_cr_ids" IS NULL
          )
          OR (
            "cible_type" = 'CR_SET'
            AND "cible_id" IS NULL
            AND "cible_cr_ids" IS NOT NULL
            AND array_length("cible_cr_ids", 1) >= 2
          )
          OR (
            "cible_type" = 'GLOBAL'
            AND "cible_id" IS NULL
            AND "cible_cr_ids" IS NULL
          )
        )
    `);

    // Unicité : au plus 1 affectation GLOBAL active par utilisateur.
    await q.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_user_perimetres_global_actif"
        ON "user_perimetres" ("fk_user")
        WHERE "actif" = true AND "cible_type" = 'GLOBAL'
    `);

    // 3. INSERT GLOBAL pour les utilisateurs de gouvernance (idempotent).
    const emailsList =
      AjouterPerimetreGlobalEtAssainirBridge1779200000560.GLOBAL_EMAILS.map(
        (e) => `'${e}'`,
      ).join(',');
    await q.query(`
      INSERT INTO "user_perimetres"
        ("fk_user", "cible_type", "cible_id", "cible_cr_ids", "origine",
         "date_debut", "actif", "utilisateur_creation", "motif")
      SELECT
        u."id", 'GLOBAL', NULL, NULL, 'AFFECTATION',
        CURRENT_DATE, true, 'migration 560',
        '${AjouterPerimetreGlobalEtAssainirBridge1779200000560.MOTIF_GLOBAL}'
      FROM "user" u
      WHERE u."email" IN (${emailsList})
        AND NOT EXISTS (
          SELECT 1 FROM "user_perimetres" up
          WHERE up."fk_user" = u."id"
            AND up."actif" = true
            AND up."cible_type" = 'GLOBAL'
        )
    `);

    // 4a. Rôles à portée globale → perimetre_type='global' (idempotent).
    await q.query(`
      UPDATE "bridge_user_role" bur
        SET "perimetre_type" = 'global'
      WHERE bur."perimetre_type" IS DISTINCT FROM 'global'
        AND bur."perimetre_id" IS NULL
        AND bur."fk_role" IN (
          SELECT id FROM "ref_role"
          WHERE code_role IN ('ADMIN','PUBLICATEUR','COORDINATEUR','AUDITEUR','LECTEUR')
        )
    `);

    // 4b. Rôles terrain au 'global' factice → 'centre_responsabilite',
    //     UNIQUEMENT si le user a déjà un périmètre explicite (sinon on
    //     supprimerait leur seul accès via le fallback bridge).
    await q.query(`
      UPDATE "bridge_user_role" bur
        SET "perimetre_type" = 'centre_responsabilite',
            "date_modification" = CURRENT_TIMESTAMP,
            "utilisateur_modification" = '${AjouterPerimetreGlobalEtAssainirBridge1779200000560.MARQUEUR_BRIDGE}'
      WHERE bur."perimetre_type" = 'global'
        AND bur."perimetre_id" IS NULL
        AND bur."fk_role" IN (
          SELECT id FROM "ref_role" WHERE code_role IN ('SAISISSEUR','VALIDATEUR')
        )
        AND EXISTS (
          SELECT 1 FROM "user_perimetres" up
          WHERE up."fk_user" = bur."fk_user"
            AND up."actif" = true
            AND up."cible_type" IN ('STRUCTURE','CR','CR_SET')
        )
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    // 4b inverse : restaure les bridges terrain assainis à 'global'.
    await q.query(`
      UPDATE "bridge_user_role"
        SET "perimetre_type" = 'global',
            "date_modification" = CURRENT_TIMESTAMP,
            "utilisateur_modification" = 'migration 560 (down)'
      WHERE "utilisateur_modification" = '${AjouterPerimetreGlobalEtAssainirBridge1779200000560.MARQUEUR_BRIDGE}'
        AND "perimetre_type" = 'centre_responsabilite'
    `);

    // 3 inverse : retire les affectations GLOBAL insérées.
    await q.query(`
      DELETE FROM "user_perimetres"
      WHERE "cible_type" = 'GLOBAL'
        AND "motif" = '${AjouterPerimetreGlobalEtAssainirBridge1779200000560.MOTIF_GLOBAL}'
    `);

    // Index + CHECK : retour à l'état pré-560 (sans GLOBAL).
    await q.query(`DROP INDEX IF EXISTS "uq_user_perimetres_global_actif"`);

    await q.query(`
      ALTER TABLE "user_perimetres"
        DROP CONSTRAINT IF EXISTS "ck_user_perimetres_cible_coherence"
    `);
    await q.query(`
      ALTER TABLE "user_perimetres"
        ADD CONSTRAINT "ck_user_perimetres_cible_coherence"
        CHECK (
          (
            "cible_type" IN ('STRUCTURE','CR')
            AND "cible_id" IS NOT NULL
            AND "cible_cr_ids" IS NULL
          )
          OR (
            "cible_type" = 'CR_SET'
            AND "cible_id" IS NULL
            AND "cible_cr_ids" IS NOT NULL
            AND array_length("cible_cr_ids", 1) >= 2
          )
        )
    `);

    await q.query(`
      ALTER TABLE "user_perimetres"
        DROP CONSTRAINT IF EXISTS "ck_user_perimetres_cible_type"
    `);
    await q.query(`
      ALTER TABLE "user_perimetres"
        ADD CONSTRAINT "ck_user_perimetres_cible_type"
        CHECK ("cible_type" IN ('STRUCTURE','CR','CR_SET'))
    `);
  }
}
