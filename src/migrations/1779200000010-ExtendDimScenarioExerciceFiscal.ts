import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lot 3.2 — Préparation du hook Q9 (auto-création du scénario MEDIAN
 * à la création d'une version pour un exercice fiscal donné).
 *
 * 1. ALTER TABLE `dim_scenario` ADD COLUMN `exercice_fiscal int NULL`.
 *    Les 3 scénarios seedés au Lot 2.4 (CENTRAL / ALTERNATIF_HAUT /
 *    ALTERNATIF_BAS) restent à NULL — sémantique « hypothèse macro
 *    non rattachée à un exercice », cohérent avec leur usage initial.
 *    Les nouveaux scénarios créés via le hook auront l'exercice
 *    renseigné.
 *
 * 2. INSERT dans `ref_type_action_audit` la valeur
 *    `AUTO_CREATE_SCENARIO` (FK existante depuis migration
 *    1779100000130-AddFkAuditLogTypeAction). Permet à
 *    `audit_log.type_action` de prendre cette valeur quand le hook
 *    crée un scénario en cascade.
 *
 * Cf. `docs/modele-donnees.md` §3.10 et `docs/audit.md`.
 */
export class ExtendDimScenarioExerciceFiscal1779200000010 implements MigrationInterface {
  name = 'ExtendDimScenarioExerciceFiscal1779200000010';

  public async up(q: QueryRunner): Promise<void> {
    // 1. Colonne exercice_fiscal sur dim_scenario.
    await q.query(`
      ALTER TABLE "dim_scenario"
        ADD COLUMN "exercice_fiscal" int
    `);

    // CHECK soft : si la valeur est renseignée, elle doit être dans
    // un range raisonnable (cohérent avec dim_version).
    await q.query(`
      ALTER TABLE "dim_scenario"
        ADD CONSTRAINT "ck_dim_scenario_exercice"
        CHECK ("exercice_fiscal" IS NULL
               OR "exercice_fiscal" BETWEEN 2020 AND 2050)
    `);

    // Index pour le hook Q9 (lookup par exercice).
    await q.query(`
      CREATE INDEX "ix_dim_scenario_exercice"
        ON "dim_scenario" ("exercice_fiscal")
        WHERE "exercice_fiscal" IS NOT NULL
    `);

    // 2. Nouveau code AUTO_CREATE_SCENARIO dans ref_type_action_audit.
    //    Idempotent via ON CONFLICT (cf. seedRefSecondaire helper).
    await q.query(`
      INSERT INTO "ref_type_action_audit"
        ("code", "libelle", "description", "ordre", "est_systeme",
         "est_actif", "utilisateur_creation")
      VALUES
        ('AUTO_CREATE_SCENARIO',
         'Création automatique de scénario',
         'Hook applicatif : création du scénario MEDIAN_<exercice> ' ||
         'déclenchée automatiquement à la création d''une version ' ||
         'budgétaire pour un exercice sans scénario existant (Q9).',
         85, true, true, 'system')
      ON CONFLICT ("code") DO NOTHING
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`
      DELETE FROM "ref_type_action_audit"
       WHERE "code" = 'AUTO_CREATE_SCENARIO'
    `);
    await q.query(`DROP INDEX IF EXISTS "public"."ix_dim_scenario_exercice"`);
    await q.query(
      `ALTER TABLE "dim_scenario" DROP CONSTRAINT IF EXISTS "ck_dim_scenario_exercice"`,
    );
    await q.query(
      `ALTER TABLE "dim_scenario" DROP COLUMN IF EXISTS "exercice_fiscal"`,
    );
  }
}
