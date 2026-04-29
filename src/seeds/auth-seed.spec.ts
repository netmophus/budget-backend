import { assertProductionPasswordPolicy } from './auth-seed';

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
