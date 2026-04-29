import { LIGNES_METIER_INITIALES } from './ligne-metier-seed';

describe('ligne-metier-seed (data shape)', () => {
  it('declares 12 lignes metier', () => {
    expect(LIGNES_METIER_INITIALES).toHaveLength(12);
  });

  it('has 4 racines (RETAIL / CORPORATE / TRESORERIE / SUPPORT)', () => {
    const racines = LIGNES_METIER_INITIALES.filter(
      (l) => l.parentCode === null,
    );
    expect(racines).toHaveLength(4);
    const codes = racines.map((r) => r.codeLigneMetier).sort();
    expect(codes).toEqual(['CORPORATE', 'RETAIL', 'SUPPORT', 'TRESORERIE']);
    for (const r of racines) {
      expect(r.niveau).toBe(1);
    }
  });

  it('lists parents before their children', () => {
    const seen = new Set<string>();
    for (const l of LIGNES_METIER_INITIALES) {
      if (l.parentCode !== null) {
        expect(seen.has(l.parentCode)).toBe(true);
      }
      seen.add(l.codeLigneMetier);
    }
  });

  it('every child has niveau = parent.niveau + 1', () => {
    const byCode = new Map(
      LIGNES_METIER_INITIALES.map((l) => [l.codeLigneMetier, l]),
    );
    for (const l of LIGNES_METIER_INITIALES) {
      if (l.parentCode === null) continue;
      const parent = byCode.get(l.parentCode);
      expect(parent).toBeDefined();
      expect(l.niveau).toBe(parent!.niveau + 1);
    }
  });

  it('all codes match [A-Z0-9_]+', () => {
    for (const l of LIGNES_METIER_INITIALES) {
      expect(l.codeLigneMetier).toMatch(/^[A-Z0-9_]+$/);
    }
  });
});
