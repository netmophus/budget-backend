import { COMPTES_INITIAUX } from './compte-seed';

describe('compte-seed (data shape)', () => {
  it('declares ~95 comptes (80–120 range)', () => {
    expect(COMPTES_INITIAUX.length).toBeGreaterThanOrEqual(80);
    expect(COMPTES_INITIAUX.length).toBeLessThanOrEqual(120);
  });

  it('has 6 racines (one per classe in {1,2,4,5,6,7})', () => {
    const racines = COMPTES_INITIAUX.filter((c) => c.parentCode === null);
    expect(racines).toHaveLength(6);
    const classes = racines.map((r) => r.classe).sort();
    expect(classes).toEqual([1, 2, 4, 5, 6, 7]);
    for (const r of racines) {
      expect(r.niveau).toBe(1);
    }
  });

  it('lists parents before their children (insertion order safe)', () => {
    const seen = new Set<string>();
    for (const c of COMPTES_INITIAUX) {
      if (c.parentCode !== null) {
        expect(seen.has(c.parentCode)).toBe(true);
      }
      seen.add(c.codeCompte);
    }
  });

  it('every child has niveau = parent.niveau + 1', () => {
    const byCode = new Map(COMPTES_INITIAUX.map((c) => [c.codeCompte, c]));
    for (const c of COMPTES_INITIAUX) {
      if (c.parentCode === null) continue;
      const parent = byCode.get(c.parentCode);
      expect(parent).toBeDefined();
      expect(c.niveau).toBe(parent!.niveau + 1);
    }
  });

  it('every child has the same classe as its parent', () => {
    const byCode = new Map(COMPTES_INITIAUX.map((c) => [c.codeCompte, c]));
    for (const c of COMPTES_INITIAUX) {
      if (c.parentCode === null) continue;
      const parent = byCode.get(c.parentCode);
      expect(c.classe).toBe(parent!.classe);
    }
  });

  it('all codeCompte are numeric strings', () => {
    for (const c of COMPTES_INITIAUX) {
      expect(c.codeCompte).toMatch(/^[0-9]+$/);
    }
  });

  it('charges (classe 6) have sens=D and produits (classe 7) sens=C on collective accounts', () => {
    const charges = COMPTES_INITIAUX.filter(
      (c) => c.classe === 6 && c.estCompteCollectif,
    );
    for (const c of charges) {
      expect(c.sens).toBe('D');
    }
    const produits = COMPTES_INITIAUX.filter(
      (c) => c.classe === 7 && c.estCompteCollectif,
    );
    for (const p of produits) {
      expect(p.sens).toBe('C');
    }
  });
});
