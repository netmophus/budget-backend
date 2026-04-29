import {
  dropScd2Indexes,
  enforceAlwaysIdentity,
  scd2Columns,
  scd2Indexes,
} from './scd2-helpers';

describe('scd2-helpers', () => {
  describe('scd2Columns', () => {
    const sql = scd2Columns();

    it('declares date_debut_validite and date_fin_validite with the right nullity', () => {
      expect(sql).toMatch(/"date_debut_validite"\s+date\s+NOT NULL/);
      expect(sql).toMatch(/"date_fin_validite"\s+date(?!\s+NOT)/);
    });

    it('defaults version_courante and est_actif to true (NOT NULL boolean)', () => {
      expect(sql).toMatch(
        /"version_courante"\s+boolean\s+NOT NULL\s+DEFAULT\s+true/,
      );
      expect(sql).toMatch(
        /"est_actif"\s+boolean\s+NOT NULL\s+DEFAULT\s+true/,
      );
    });

    it('defaults date_creation to CURRENT_TIMESTAMP and date_modification is nullable', () => {
      expect(sql).toMatch(
        /"date_creation"\s+timestamp\s+NOT NULL\s+DEFAULT\s+CURRENT_TIMESTAMP/,
      );
      expect(sql).toMatch(/"date_modification"\s+timestamp(?!\s+NOT)/);
    });

    it('defaults utilisateur_creation to system (varchar 255 NOT NULL) and leaves utilisateur_modification nullable', () => {
      expect(sql).toMatch(
        /"utilisateur_creation"\s+varchar\(255\)\s+NOT NULL\s+DEFAULT\s+'system'/,
      );
      expect(sql).toMatch(/"utilisateur_modification"\s+varchar\(255\)/);
    });

    it('returns a fragment without trailing comma so it can be inlined in CREATE TABLE', () => {
      expect(scd2Columns().trim().endsWith(',')).toBe(false);
    });
  });

  describe('scd2Indexes', () => {
    it('returns three index statements for a given table + business key', () => {
      const stmts = scd2Indexes('dim_test', 'code_test');
      expect(stmts).toEqual([
        `CREATE INDEX "ix_dim_test_business_key_courant" ON "dim_test" ("code_test", "version_courante")`,
        `CREATE INDEX "ix_dim_test_business_key_debut" ON "dim_test" ("code_test", "date_debut_validite")`,
        `CREATE UNIQUE INDEX "uq_dim_test_courante" ON "dim_test" ("code_test") WHERE "version_courante" = true`,
      ]);
    });

    it('produces a partial unique index restricted to versionCourante=true', () => {
      const [, , unique] = scd2Indexes('dim_compte', 'code_compte');
      expect(unique).toContain('UNIQUE INDEX');
      expect(unique).toContain('WHERE "version_courante" = true');
    });
  });

  describe('enforceAlwaysIdentity', () => {
    it('returns the ALTER TABLE that switches the PK to GENERATED ALWAYS', () => {
      expect(enforceAlwaysIdentity('dim_test')).toBe(
        `ALTER TABLE "dim_test" ALTER COLUMN "id" SET GENERATED ALWAYS`,
      );
    });
  });

  describe('dropScd2Indexes', () => {
    it('returns idempotent DROP INDEX statements in reverse order of creation', () => {
      expect(dropScd2Indexes('dim_test')).toEqual([
        `DROP INDEX IF EXISTS "public"."uq_dim_test_courante"`,
        `DROP INDEX IF EXISTS "public"."ix_dim_test_business_key_debut"`,
        `DROP INDEX IF EXISTS "public"."ix_dim_test_business_key_courant"`,
      ]);
    });
  });
});
