import { SEGMENTS_INITIAUX } from './segment-seed';

describe('segment-seed (data shape)', () => {
  it('declares exactly 6 segments (Option A — plat)', () => {
    expect(SEGMENTS_INITIAUX).toHaveLength(6);
  });

  it('covers exactly the 6 categorie enum values once each', () => {
    const cats = SEGMENTS_INITIAUX.map((s) => s.categorie).sort();
    expect(cats).toEqual([
      'grande_entreprise',
      'institutionnel',
      'particulier',
      'pme',
      'professionnel',
      'secteur_public',
    ]);
  });

  it('all codes are uppercase + underscore', () => {
    for (const s of SEGMENTS_INITIAUX) {
      expect(s.codeSegment).toMatch(/^[A-Z_]+$/);
    }
  });

  it('libelles are non-empty', () => {
    for (const s of SEGMENTS_INITIAUX) {
      expect(s.libelle.length).toBeGreaterThan(0);
    }
  });
});
