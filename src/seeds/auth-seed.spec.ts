import { assertProductionPasswordPolicy, PERMISSIONS } from './auth-seed';

describe('PERMISSIONS seed list', () => {
  it('contains the two REFERENTIEL permissions', () => {
    const codes = PERMISSIONS.map((p) => p.code);
    expect(codes).toContain('REFERENTIEL.LIRE');
    expect(codes).toContain('REFERENTIEL.GERER');
  });

  it('declares REFERENTIEL.LIRE under module REFERENTIEL', () => {
    const lire = PERMISSIONS.find((p) => p.code === 'REFERENTIEL.LIRE');
    expect(lire?.module).toBe('REFERENTIEL');
    expect(lire?.libelle).toBe('Lire les référentiels');
  });

  it('declares REFERENTIEL.GERER under module REFERENTIEL with a description', () => {
    const gerer = PERMISSIONS.find((p) => p.code === 'REFERENTIEL.GERER');
    expect(gerer?.module).toBe('REFERENTIEL');
    expect(gerer?.description).toBeDefined();
  });

  // ─── Lot 3.1 : permissions workflow budget

  it('contient les 6 permissions BUDGET attendues (Lot 3.1)', () => {
    const codesBudget = PERMISSIONS.filter((p) => p.module === 'BUDGET').map(
      (p) => p.code,
    );
    expect(codesBudget).toEqual(
      expect.arrayContaining([
        'BUDGET.LIRE',
        'BUDGET.SAISIR',
        'BUDGET.SUPPRIMER',
        'BUDGET.SOUMETTRE',
        'BUDGET.VALIDER',
        'BUDGET.PUBLIER',
      ]),
    );
    expect(codesBudget).toHaveLength(6);
  });

  it('BUDGET.SOUMETTRE / VALIDER / PUBLIER ont chacun une description', () => {
    for (const code of [
      'BUDGET.SOUMETTRE',
      'BUDGET.VALIDER',
      'BUDGET.PUBLIER',
    ]) {
      const perm = PERMISSIONS.find((p) => p.code === code);
      expect(perm).toBeDefined();
      expect(perm?.module).toBe('BUDGET');
      expect(perm?.description).toBeDefined();
      expect(perm?.description?.length ?? 0).toBeGreaterThan(20);
    }
  });
});

describe('assertProductionPasswordPolicy', () => {
  const ENV_VAR = 'SEED_TEST_PASSWORD';
  const originalNodeEnv = process.env.NODE_ENV;
  const originalSeedTest = process.env[ENV_VAR];

  afterEach(() => {
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
    if (originalSeedTest === undefined) {
      delete process.env[ENV_VAR];
    } else {
      process.env[ENV_VAR] = originalSeedTest;
    }
  });

  it('throws in production when the password env var is missing', () => {
    process.env.NODE_ENV = 'production';
    delete process.env[ENV_VAR];

    expect(() => assertProductionPasswordPolicy(ENV_VAR)).toThrow(
      /SEED_TEST_PASSWORD doit être défini en production/,
    );
  });

  it('does not throw in production when the password env var is set', () => {
    process.env.NODE_ENV = 'production';
    process.env[ENV_VAR] = 'a-secure-prod-password';

    expect(() => assertProductionPasswordPolicy(ENV_VAR)).not.toThrow();
  });

  it('does not throw in development when the env var is missing (fallback to default is allowed)', () => {
    process.env.NODE_ENV = 'development';
    delete process.env[ENV_VAR];

    expect(() => assertProductionPasswordPolicy(ENV_VAR)).not.toThrow();
  });
});
