import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Extension `fait_budget` pour le mode `ENCOURS_TIE` (Lot 3.1 — option
 * D-medium retenue après audit). Ajout de 4 colonnes :
 *
 *  - `mode_saisie varchar(20) NOT NULL DEFAULT 'MONTANT'` —
 *    discriminant : `'MONTANT'` (saisie directe) ou `'ENCOURS_TIE'`
 *    (saisie par encours moyen × TIE annuel, mensualisée par le
 *    service à `montant = encours × tie / 12`).
 *  - `encours_moyen numeric(20,4) NULL` — encours moyen mensuel
 *    (numerique large, pas de signe).
 *  - `tie numeric(7,4) NULL` — taux d'intérêt effectif annuel décimal
 *    (ex. 0.0850 = 8,50%). Range [0,1] forcé en CHECK.
 *  - `commentaire text NULL` — justification libre saisie utilisateur.
 *
 * Backfill : aucun (DEFAULT 'MONTANT' couvre les ~0 lignes existantes ;
 * les 3 nouvelles colonnes restent NULL ce qui satisfait le CHECK de
 * cohérence).
 *
 * Cf. `docs/modele-donnees.md` §4.1 (mode ENCOURS_TIE) et la décision
 * Q7 de la simulation budget Lot 3.
 */
export class ExtendFaitBudgetModeSaisieEncoursTie1779200000000 implements MigrationInterface {
  name = 'ExtendFaitBudgetModeSaisieEncoursTie1779200000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE "fait_budget"
        ADD COLUMN "mode_saisie" varchar(20) NOT NULL DEFAULT 'MONTANT',
        ADD COLUMN "encours_moyen" numeric(20,4),
        ADD COLUMN "tie" numeric(7,4),
        ADD COLUMN "commentaire" text
    `);

    await q.query(`
      ALTER TABLE "fait_budget"
        ADD CONSTRAINT "ck_fait_budget_mode"
        CHECK ("mode_saisie" IN ('MONTANT','ENCOURS_TIE'))
    `);

    await q.query(`
      ALTER TABLE "fait_budget"
        ADD CONSTRAINT "ck_fait_budget_tie_range"
        CHECK ("tie" IS NULL OR ("tie" >= 0 AND "tie" <= 1))
    `);

    await q.query(`
      ALTER TABLE "fait_budget"
        ADD CONSTRAINT "ck_fait_budget_encours_positif"
        CHECK ("encours_moyen" IS NULL OR "encours_moyen" >= 0)
    `);

    // CHECK conditionnel : MONTANT impose encours/tie NULL ; ENCOURS_TIE
    // impose encours et tie NOT NULL. Garde-fou DB en plus de la
    // validation applicative côté service.
    await q.query(`
      ALTER TABLE "fait_budget"
        ADD CONSTRAINT "ck_fait_budget_coherence_mode"
        CHECK (
          (
            "mode_saisie" = 'ENCOURS_TIE'
            AND "encours_moyen" IS NOT NULL
            AND "tie" IS NOT NULL
          )
          OR
          (
            "mode_saisie" = 'MONTANT'
            AND "encours_moyen" IS NULL
            AND "tie" IS NULL
          )
        )
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE "fait_budget" DROP CONSTRAINT IF EXISTS "ck_fait_budget_coherence_mode"`,
    );
    await q.query(
      `ALTER TABLE "fait_budget" DROP CONSTRAINT IF EXISTS "ck_fait_budget_encours_positif"`,
    );
    await q.query(
      `ALTER TABLE "fait_budget" DROP CONSTRAINT IF EXISTS "ck_fait_budget_tie_range"`,
    );
    await q.query(
      `ALTER TABLE "fait_budget" DROP CONSTRAINT IF EXISTS "ck_fait_budget_mode"`,
    );
    await q.query(`
      ALTER TABLE "fait_budget"
        DROP COLUMN IF EXISTS "commentaire",
        DROP COLUMN IF EXISTS "tie",
        DROP COLUMN IF EXISTS "encours_moyen",
        DROP COLUMN IF EXISTS "mode_saisie"
    `);
  }
}
