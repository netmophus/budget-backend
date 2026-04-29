import { TAUX_INITIAUX } from './taux-change-seed';

describe('taux-change-seed (data shape)', () => {
  it('declares 18 taux (6 devises × 3 dates)', () => {
    expect(TAUX_INITIAUX).toHaveLength(18);
  });

  it('covers 6 devises non-pivot (EUR, USD, GBP, NGN, GHS, CNY)', () => {
    const devises = Array.from(
      new Set(TAUX_INITIAUX.map((t) => t.codeDevise)),
    ).sort();
    expect(devises).toEqual(['CNY', 'EUR', 'GBP', 'GHS', 'NGN', 'USD']);
  });

  it('every taux is strictly positive', () => {
    for (const t of TAUX_INITIAUX) {
      expect(parseFloat(t.tauxVersPivot)).toBeGreaterThan(0);
    }
  });

  it('1 fixe_budgetaire et 2 cloture par devise', () => {
    for (const code of ['EUR', 'USD', 'GBP', 'NGN', 'GHS', 'CNY']) {
      const lignes = TAUX_INITIAUX.filter((t) => t.codeDevise === code);
      const fixes = lignes.filter((t) => t.typeTaux === 'fixe_budgetaire');
      const clotures = lignes.filter((t) => t.typeTaux === 'cloture');
      expect(fixes).toHaveLength(1);
      expect(clotures).toHaveLength(2);
    }
  });

  it('dates de cloture : 2026-03-31 (T1) et 2026-06-30 (S1)', () => {
    const dates = Array.from(
      new Set(
        TAUX_INITIAUX.filter((t) => t.typeTaux === 'cloture').map(
          (t) => t.date,
        ),
      ),
    ).sort();
    expect(dates).toEqual(['2026-03-31', '2026-06-30']);
  });
});
