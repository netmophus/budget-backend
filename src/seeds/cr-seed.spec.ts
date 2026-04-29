import { CRS_INITIAUX } from './cr-seed';

describe('cr-seed (data shape)', () => {
  it('declares 6 CR initiaux', () => {
    expect(CRS_INITIAUX).toHaveLength(6);
  });

  it('each CR has a non-empty codeCr matching [A-Z0-9_-]+', () => {
    for (const cr of CRS_INITIAUX) {
      expect(cr.codeCr).toMatch(/^[A-Z0-9_-]+$/);
    }
  });

  it('typeCr is one of cdc / cdp / cdr / autre', () => {
    for (const cr of CRS_INITIAUX) {
      expect(['cdc', 'cdp', 'cdr', 'autre']).toContain(cr.typeCr);
    }
  });

  it('each CR points to a known structure code (parents from 2.3A seed)', () => {
    const knownStructures = [
      'SOC_BANK_UEMOA',
      'BR_CIV',
      'BR_SEN',
      'BR_BFA',
      'DIR_CIV_RETAIL',
      'DIR_CIV_CORPORATE',
      'DEPT_CIV_PARTICULIERS',
      'AG_ABJ_PLATEAU',
      'AG_ABJ_COCODY',
    ];
    for (const cr of CRS_INITIAUX) {
      expect(knownStructures).toContain(cr.parentCodeStructure);
    }
  });

  it('exactly one CR is type cdc (BR_CIV fonctions)', () => {
    const cdcs = CRS_INITIAUX.filter((c) => c.typeCr === 'cdc');
    expect(cdcs).toHaveLength(1);
    expect(cdcs[0]!.parentCodeStructure).toBe('BR_CIV');
  });
});
