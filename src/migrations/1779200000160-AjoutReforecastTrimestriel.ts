import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lot 5.3.A — Reforecast trimestriel.
 *
 * Étend `dim_version` avec 9 colonnes pour gérer un type de version
 * `reforecast` (trimestriel, publication-écrasement) :
 *  - métadonnées de génération : `fk_version_source`,
 *    `fk_scenario_source`, `trimestre_consolide`, `annee_consolide`,
 *    `methode_extrapolation`
 *  - cycle de vie d'écrasement : `statut_publication`
 *    (ACTIVE/OBSOLETE), `date_obsolescence`, `fk_version_remplacante`
 *
 * Ajoute également :
 *  - `type_version = 'reforecast'` au référentiel `ref_type_version`
 *    (les valeurs existantes `budget_initial / reforecast_1 /
 *    reforecast_2 / atterrissage` sont conservées telles quelles)
 *  - 1 permission RBAC `BUDGET.REFORECAST_LANCER` (ADMIN + VALIDATEUR)
 *  - 6 codes audit `*_REFORECAST` (LANCER / SOUMETTRE / VALIDER /
 *    REJETER / PUBLIER / MARQUER_OBSOLETE)
 *
 * Décisions produit (Lot 5.3) :
 *  - Q1 : un nouveau reforecast écrase l'ancien en marquant
 *    `statut_publication = 'OBSOLETE'` (audit conservé).
 *  - Q2 : pas de nouvelle table `fait_reforecast` — réutilisation du
 *    couple (`dim_version` type=`reforecast`, `fait_budget`).
 *  - Q3 : 1 seule nouvelle permission ; le workflow réutilise
 *    BUDGET.SAISIR / SOUMETTRE / VALIDER / PUBLIER existants.
 *
 * Idempotente : ALTER TABLE IF NOT EXISTS COLUMN, ON CONFLICT DO
 * NOTHING pour permissions / codes audit / référentiel, INSERT
 * WHERE NOT EXISTS pour bridges_role_permission.
 */
export class AjoutReforecastTrimestriel1779200000160 implements MigrationInterface {
  name = 'AjoutReforecastTrimestriel1779200000160';

  public async up(q: QueryRunner): Promise<void> {
    // ─── 1. Extensions colonnes dim_version ────────────────────────
    await q.query(`
      ALTER TABLE "dim_version"
        ADD COLUMN IF NOT EXISTS "fk_version_source" bigint NULL,
        ADD COLUMN IF NOT EXISTS "fk_scenario_source" bigint NULL,
        ADD COLUMN IF NOT EXISTS "trimestre_consolide" int NULL,
        ADD COLUMN IF NOT EXISTS "annee_consolide" int NULL,
        ADD COLUMN IF NOT EXISTS "methode_extrapolation" varchar(30) NULL,
        ADD COLUMN IF NOT EXISTS "statut_publication" varchar(20) NOT NULL DEFAULT 'ACTIVE',
        ADD COLUMN IF NOT EXISTS "date_obsolescence" timestamp NULL,
        ADD COLUMN IF NOT EXISTS "fk_version_remplacante" bigint NULL
    `);

    // ─── 2. Foreign keys (idempotente via DO block) ───────────────
    await q.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'fk_dim_version_source'
        ) THEN
          ALTER TABLE "dim_version"
            ADD CONSTRAINT "fk_dim_version_source"
            FOREIGN KEY ("fk_version_source") REFERENCES "dim_version"("id")
            ON DELETE RESTRICT;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'fk_dim_version_scenario_source'
        ) THEN
          ALTER TABLE "dim_version"
            ADD CONSTRAINT "fk_dim_version_scenario_source"
            FOREIGN KEY ("fk_scenario_source") REFERENCES "dim_scenario"("id")
            ON DELETE RESTRICT;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'fk_dim_version_remplacante'
        ) THEN
          ALTER TABLE "dim_version"
            ADD CONSTRAINT "fk_dim_version_remplacante"
            FOREIGN KEY ("fk_version_remplacante") REFERENCES "dim_version"("id")
            ON DELETE SET NULL;
        END IF;
      END$$;
    `);

    // ─── 3. CHECK constraints (idempotents) ────────────────────────
    await q.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'chk_dim_version_statut_publication'
        ) THEN
          ALTER TABLE "dim_version"
            ADD CONSTRAINT "chk_dim_version_statut_publication"
            CHECK ("statut_publication" IN ('ACTIVE','OBSOLETE'));
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'chk_dim_version_methode_extrapolation'
        ) THEN
          ALTER TABLE "dim_version"
            ADD CONSTRAINT "chk_dim_version_methode_extrapolation"
            CHECK (
              "methode_extrapolation" IS NULL
              OR "methode_extrapolation" IN ('MOYENNE_TRIMESTRE','BUDGET_INITIAL','MANUELLE')
            );
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'chk_dim_version_trimestre'
        ) THEN
          ALTER TABLE "dim_version"
            ADD CONSTRAINT "chk_dim_version_trimestre"
            CHECK (
              "trimestre_consolide" IS NULL
              OR "trimestre_consolide" BETWEEN 1 AND 4
            );
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'chk_dim_version_reforecast_coherence'
        ) THEN
          ALTER TABLE "dim_version"
            ADD CONSTRAINT "chk_dim_version_reforecast_coherence"
            CHECK (
              ("type_version" <> 'reforecast'
                AND "fk_version_source" IS NULL
                AND "fk_scenario_source" IS NULL
                AND "trimestre_consolide" IS NULL
                AND "annee_consolide" IS NULL
                AND "methode_extrapolation" IS NULL)
              OR
              ("type_version" = 'reforecast'
                AND "fk_version_source" IS NOT NULL
                AND "fk_scenario_source" IS NOT NULL
                AND "trimestre_consolide" IS NOT NULL
                AND "annee_consolide" IS NOT NULL
                AND "methode_extrapolation" IS NOT NULL)
            );
        END IF;
      END$$;
    `);

    // ─── 4. Index ──────────────────────────────────────────────────
    await q.query(`
      CREATE INDEX IF NOT EXISTS "idx_dim_version_source"
        ON "dim_version" ("fk_version_source")
    `);
    await q.query(`
      CREATE INDEX IF NOT EXISTS "idx_dim_version_statut_publication"
        ON "dim_version" ("statut_publication")
    `);

    // ─── 5. Référentiel ref_type_version : ajoute 'reforecast' ─────
    await q.query(`
      INSERT INTO "ref_type_version"
        ("code","libelle","description","ordre","est_systeme","est_actif","utilisateur_creation")
      VALUES
        ('reforecast',
         'Reforecast trimestriel',
         'Reforecast trimestriel avec écrasement (publication-écrasement). Lot 5.3.',
         50, true, true, 'system (Lot 5.3)')
      ON CONFLICT ("code") DO NOTHING
    `);

    // ─── 6. Permission BUDGET.REFORECAST_LANCER ────────────────────
    await q.query(`
      INSERT INTO "ref_permission"
        ("code_permission","libelle","description","module","utilisateur_creation")
      VALUES
        ('BUDGET.REFORECAST_LANCER',
         'Lancer un reforecast trimestriel',
         'Créer une nouvelle version de type reforecast à partir d''une version publiée + un trimestre consolidé. Écrase tout reforecast ACTIVE pré-existant pour la même clé en le marquant OBSOLETE. Lot 5.3.',
         'BUDGET','system (Lot 5.3)')
      ON CONFLICT ("code_permission") DO NOTHING
    `);

    // ─── 7. Attribution ADMIN + VALIDATEUR ─────────────────────────
    const ATTRIBUTIONS: Array<[string, string]> = [
      ['ADMIN', 'BUDGET.REFORECAST_LANCER'],
      ['VALIDATEUR', 'BUDGET.REFORECAST_LANCER'],
    ];
    for (const [roleCode, permCode] of ATTRIBUTIONS) {
      const roleRows = (await q.query(
        `SELECT "id" FROM "ref_role" WHERE "code_role" = $1`,
        [roleCode],
      )) as Array<{ id: string }>;
      const permRows = (await q.query(
        `SELECT "id" FROM "ref_permission" WHERE "code_permission" = $1`,
        [permCode],
      )) as Array<{ id: string }>;
      if (roleRows.length === 0 || permRows.length === 0) continue;
      await q.query(
        `INSERT INTO "bridge_role_permission" ("fk_role","fk_permission")
         SELECT $1::bigint, $2::bigint
         WHERE NOT EXISTS (
           SELECT 1 FROM "bridge_role_permission"
            WHERE "fk_role" = $1::bigint AND "fk_permission" = $2::bigint
         )`,
        [roleRows[0]!.id, permRows[0]!.id],
      );
    }

    // ─── 8. Codes audit *_REFORECAST ───────────────────────────────
    await q.query(`
      INSERT INTO "ref_type_action_audit"
        ("code","libelle","description","ordre","est_systeme","est_actif","utilisateur_creation")
      VALUES
        ('LANCER_REFORECAST',
         'Lancer un reforecast',
         'Création d''une version de type reforecast (avec génération des lignes fait_budget extrapolées et marquage éventuel OBSOLETE de l''ancien). Lot 5.3.',
         140, true, true, 'system (Lot 5.3)'),
        ('SOUMETTRE_REFORECAST',
         'Soumettre un reforecast',
         'Transition ouvert → soumis sur une version reforecast. Lot 5.3.',
         141, true, true, 'system (Lot 5.3)'),
        ('VALIDER_REFORECAST',
         'Valider un reforecast',
         'Transition soumis → valide sur une version reforecast. Lot 5.3.',
         142, true, true, 'system (Lot 5.3)'),
        ('REJETER_REFORECAST',
         'Rejeter un reforecast',
         'Transition soumis → ouvert sur une version reforecast (avec motif). Lot 5.3.',
         143, true, true, 'system (Lot 5.3)'),
        ('PUBLIER_REFORECAST',
         'Publier un reforecast',
         'Transition valide → gele (publication) sur une version reforecast. Lot 5.3.',
         144, true, true, 'system (Lot 5.3)'),
        ('MARQUER_REFORECAST_OBSOLETE',
         'Marquer un reforecast comme obsolète',
         'Passage statut_publication=OBSOLETE déclenché par un nouveau lancer() (écrasement). Lot 5.3.',
         145, true, true, 'system (Lot 5.3)')
      ON CONFLICT ("code") DO NOTHING
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    // Nettoyage codes audit + permission
    await q.query(`
      DELETE FROM "ref_type_action_audit"
       WHERE "code" IN (
         'LANCER_REFORECAST','SOUMETTRE_REFORECAST',
         'VALIDER_REFORECAST','REJETER_REFORECAST',
         'PUBLIER_REFORECAST','MARQUER_REFORECAST_OBSOLETE'
       )
    `);
    await q.query(`
      DELETE FROM "bridge_role_permission"
       WHERE "fk_permission" IN (
         SELECT "id" FROM "ref_permission"
          WHERE "code_permission" = 'BUDGET.REFORECAST_LANCER'
       )
    `);
    await q.query(`
      DELETE FROM "ref_permission"
       WHERE "code_permission" = 'BUDGET.REFORECAST_LANCER'
    `);
    await q.query(`
      DELETE FROM "ref_type_version" WHERE "code" = 'reforecast'
    `);

    // Supprime les contraintes / index / colonnes (ordre inverse)
    await q.query(`DROP INDEX IF EXISTS "idx_dim_version_statut_publication"`);
    await q.query(`DROP INDEX IF EXISTS "idx_dim_version_source"`);
    await q.query(`
      ALTER TABLE "dim_version"
        DROP CONSTRAINT IF EXISTS "chk_dim_version_reforecast_coherence",
        DROP CONSTRAINT IF EXISTS "chk_dim_version_trimestre",
        DROP CONSTRAINT IF EXISTS "chk_dim_version_methode_extrapolation",
        DROP CONSTRAINT IF EXISTS "chk_dim_version_statut_publication",
        DROP CONSTRAINT IF EXISTS "fk_dim_version_remplacante",
        DROP CONSTRAINT IF EXISTS "fk_dim_version_scenario_source",
        DROP CONSTRAINT IF EXISTS "fk_dim_version_source",
        DROP COLUMN IF EXISTS "fk_version_remplacante",
        DROP COLUMN IF EXISTS "date_obsolescence",
        DROP COLUMN IF EXISTS "statut_publication",
        DROP COLUMN IF EXISTS "methode_extrapolation",
        DROP COLUMN IF EXISTS "annee_consolide",
        DROP COLUMN IF EXISTS "trimestre_consolide",
        DROP COLUMN IF EXISTS "fk_scenario_source",
        DROP COLUMN IF EXISTS "fk_version_source"
    `);
  }
}
