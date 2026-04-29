import { PRODUITS_INITIAUX } from './produit-seed';

describe('produit-seed (data shape)', () => {
  it('declares ~25 produits (range 20–30)', () => {
    expect(PRODUITS_INITIAUX.length).toBeGreaterThanOrEqual(20);
    expect(PRODUITS_INITIAUX.length).toBeLessThanOrEqual(30);
  });

  it('has 4 racines (CREDIT_GRP / DEPOT_GRP / SERVICE_GRP / MARCHE_GRP)', () => {
    const racines = PRODUITS_INITIAUX.filter((p) => p.parentCode === null);
    expect(racines).toHaveLength(4);
    const codes = racines.map((r) => r.codeProduit).sort();
    expect(codes).toEqual([
      'CREDIT_GRP',
      'DEPOT_GRP',
      'MARCHE_GRP',
      'SERVICE_GRP',
    ]);
    for (const r of racines) {
      expect(r.niveau).toBe(1);
    }
  });

  it('lists parents before their children', () => {
    const seen = new Set<string>();
    for (const p of PRODUITS_INITIAUX) {
      if (p.parentCode !== null) {
        expect(seen.has(p.parentCode)).toBe(true);
      }
      seen.add(p.codeProduit);
    }
  });

  it('every child has niveau = parent.niveau + 1', () => {
    const byCode = new Map(
      PRODUITS_INITIAUX.map((p) => [p.codeProduit, p]),
    );
    for (const p of PRODUITS_INITIAUX) {
      if (p.parentCode === null) continue;
      const parent = byCode.get(p.parentCode);
      expect(parent).toBeDefined();
      expect(p.niveau).toBe(parent!.niveau + 1);
    }
  });

  it('every type_produit is in the enum', () => {
    const allowed = ['credit', 'depot', 'service', 'marche', 'autre'];
    for (const p of PRODUITS_INITIAUX) {
      expect(allowed).toContain(p.typeProduit);
    }
  });

  it('all codes match [A-Z0-9_]+', () => {
    for (const p of PRODUITS_INITIAUX) {
      expect(p.codeProduit).toMatch(/^[A-Z0-9_]+$/);
    }
  });

  it('has at least 5 produits porteurs d\'intérêts', () => {
    const porteurs = PRODUITS_INITIAUX.filter((p) => p.estPorteurInterets);
    expect(porteurs.length).toBeGreaterThanOrEqual(5);
  });
});
