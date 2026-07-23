import { assertProductionPasswordPolicy } from './auth-seed';

// Le catalogue RBAC (permissions socle + rôles ADMIN/LECTEUR) a été
// déplacé du seed vers la migration 1777384329142-SeedBaseRbacCatalogue
// (source unique). Sa cohérence est validée par la construction de la
// base « from scratch » via la chaîne de migrations. Le seed ne porte
// plus que la création des utilisateurs de démo — d'où la disparition
// des tests sur la liste PERMISSIONS ici.

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
