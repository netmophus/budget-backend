import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Cas spécial du Lot 2.5-bis-B : conversion int → varchar pour
 * `dim_compte.classe` afin de matcher le typage de
 * `ref_classe_compte.code` (varchar(50)). Conservation de l'index
 * existant `ix_dim_compte_classe`.
 *
 * Stratégie 6 étapes :
 *  1. ADD colonne classe_str varchar(50)
 *  2. UPDATE classe_str = classe::varchar
 *  3. DROP CHECK + DROP index sur classe (int) + DROP colonne classe (int)
 *  4. RENAME classe_str → classe
 *  5. SET NOT NULL + ADD FK vers ref_classe_compte(code)
 *  6. RECREATE index sur la nouvelle colonne varchar
 *
 * down() : opération miroir (aussi destructive — accepter qu'un
 * down complet sur dev puis up restitue la donnée. En prod le
 * down ne devrait jamais être joué.)
 */
export class AddFkDimCompteClasse1779100000050 implements MigrationInterface {
  name = 'AddFkDimCompteClasse1779100000050';

  public async up(q: QueryRunner): Promise<void> {
    // 1. Colonne temporaire
    await q.query(
      `ALTER TABLE "dim_compte" ADD COLUMN "classe_str" varchar(50)`,
    );
    // 2. Copie avec cast
    await q.query(`UPDATE "dim_compte" SET "classe_str" = "classe"::varchar`);
    // 3. Drop CHECK contrainte historique + index sur l'int + colonne
    await q.query(
      `ALTER TABLE "dim_compte" DROP CONSTRAINT IF EXISTS "ck_dim_compte_classe"`,
    );
    await q.query(`DROP INDEX IF EXISTS "public"."ix_dim_compte_classe"`);
    await q.query(`ALTER TABLE "dim_compte" DROP COLUMN "classe"`);
    // 4. Renommer
    await q.query(
      `ALTER TABLE "dim_compte" RENAME COLUMN "classe_str" TO "classe"`,
    );
    // 5. NOT NULL + FK
    await q.query(
      `ALTER TABLE "dim_compte" ALTER COLUMN "classe" SET NOT NULL`,
    );
    await q.query(
      `ALTER TABLE "dim_compte"
         ADD CONSTRAINT "fk_dim_compte_classe"
         FOREIGN KEY ("classe")
         REFERENCES "ref_classe_compte"("code")
         ON UPDATE CASCADE ON DELETE RESTRICT`,
    );
    // 6. Recréer l'index pour les filtres findByClasse
    await q.query(
      `CREATE INDEX "ix_dim_compte_classe" ON "dim_compte" ("classe")`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    // Reverse complet : varchar → int. Cast inverse, fonctionne
    // tant que les valeurs sont '1'..'9'.
    await q.query(`DROP INDEX IF EXISTS "public"."ix_dim_compte_classe"`);
    await q.query(
      `ALTER TABLE "dim_compte" DROP CONSTRAINT IF EXISTS "fk_dim_compte_classe"`,
    );
    await q.query(`ALTER TABLE "dim_compte" ADD COLUMN "classe_int" int`);
    await q.query(`UPDATE "dim_compte" SET "classe_int" = "classe"::int`);
    await q.query(`ALTER TABLE "dim_compte" DROP COLUMN "classe"`);
    await q.query(
      `ALTER TABLE "dim_compte" RENAME COLUMN "classe_int" TO "classe"`,
    );
    await q.query(
      `ALTER TABLE "dim_compte" ALTER COLUMN "classe" SET NOT NULL`,
    );
    await q.query(
      `ALTER TABLE "dim_compte"
         ADD CONSTRAINT "ck_dim_compte_classe"
         CHECK ("classe" BETWEEN 1 AND 9)`,
    );
    await q.query(
      `CREATE INDEX "ix_dim_compte_classe" ON "dim_compte" ("classe")`,
    );
  }
}
