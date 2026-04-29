import { VERSIONS_INITIALES } from './version-seed';

describe('version-seed (data shape)', () => {
  it('declares exactly 3 versions for exercice 2026', () => {
    expect(VERSIONS_INITIALES).toHaveLength(3);
    for (const v of VERSIONS_INITIALES) {
      expect(v.exerciceFiscal).toBe(2026);
    }
  });

  it('covers 3 distinct typeVersion values', () => {
    const types = VERSIONS_INITIALES.map((v) => v.typeVersion).sort();
    expect(types).toEqual(['atterrissage', 'budget_initial', 'reforecast_1']);
  });

  it('all codes match [A-Z0-9_]+', () => {
    for (const v of VERSIONS_INITIALES) {
      expect(v.codeVersion).toMatch(/^[A-Z0-9_]+$/);
    }
  });
});
