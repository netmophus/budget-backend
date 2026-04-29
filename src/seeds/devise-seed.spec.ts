import { DEVISES_INITIALES } from './devise-seed';

describe('devise-seed (data shape)', () => {
  it('declares the 7 BCEAO/UEMOA devises', () => {
    expect(DEVISES_INITIALES).toHaveLength(7);
    const codes = DEVISES_INITIALES.map((d) => d.codeIso).sort();
    expect(codes).toEqual(['CNY', 'EUR', 'GBP', 'GHS', 'NGN', 'USD', 'XOF']);
  });

  it('has exactly one pivot (XOF) with 0 decimals', () => {
    const pivots = DEVISES_INITIALES.filter((d) => d.estDevisePivot);
    expect(pivots).toHaveLength(1);
    expect(pivots[0]!.codeIso).toBe('XOF');
    expect(pivots[0]!.nbDecimales).toBe(0);
  });

  it('uses 2 decimals for all non-pivot devises', () => {
    const others = DEVISES_INITIALES.filter((d) => !d.estDevisePivot);
    for (const d of others) {
      expect(d.nbDecimales).toBe(2);
    }
  });

  it('has only 3-letter uppercase ISO codes', () => {
    for (const d of DEVISES_INITIALES) {
      expect(d.codeIso).toMatch(/^[A-Z]{3}$/);
    }
  });

  it('declares a libellé and a symbole for every devise', () => {
    for (const d of DEVISES_INITIALES) {
      expect(d.libelle.length).toBeGreaterThan(0);
      expect(d.symbole).not.toBeNull();
      expect(d.symbole!.length).toBeGreaterThan(0);
    }
  });
});
