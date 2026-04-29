import { STRUCTURES_INITIALES } from './structure-seed';

describe('structure-seed (data shape)', () => {
  it('declares the 9 hierarchical structures', () => {
    expect(STRUCTURES_INITIALES).toHaveLength(9);
  });

  it('has SOC_BANK_UEMOA as the only root (no parent)', () => {
    const roots = STRUCTURES_INITIALES.filter((s) => s.parentCode === null);
    expect(roots).toHaveLength(1);
    expect(roots[0]!.codeStructure).toBe('SOC_BANK_UEMOA');
    expect(roots[0]!.typeStructure).toBe('entite_juridique');
    expect(roots[0]!.niveauHierarchique).toBe(1);
  });

  it('lists parents before their children (insertion order safe)', () => {
    const seen = new Set<string>();
    for (const s of STRUCTURES_INITIALES) {
      if (s.parentCode !== null) {
        expect(seen.has(s.parentCode)).toBe(true);
      }
      seen.add(s.codeStructure);
    }
  });

  it('has 3 branches under SOC_BANK_UEMOA (CIV, SEN, BFA)', () => {
    const branches = STRUCTURES_INITIALES.filter(
      (s) => s.parentCode === 'SOC_BANK_UEMOA',
    );
    expect(branches.map((b) => b.codeStructure).sort()).toEqual([
      'BR_BFA',
      'BR_CIV',
      'BR_SEN',
    ]);
    for (const b of branches) {
      expect(b.typeStructure).toBe('branche');
      expect(b.niveauHierarchique).toBe(2);
    }
  });

  it('AG_ABJ_PLATEAU has 4 ancestors up to SOC_BANK_UEMOA', () => {
    // Walks the parentCode chain.
    const byCode = new Map(STRUCTURES_INITIALES.map((s) => [s.codeStructure, s]));
    const chain: string[] = [];
    let cursor: string | null | undefined = 'AG_ABJ_PLATEAU';
    while (cursor) {
      const node = byCode.get(cursor);
      if (!node || node.parentCode === null) break;
      chain.push(node.parentCode);
      cursor = node.parentCode;
    }
    expect(chain).toEqual([
      'DEPT_CIV_PARTICULIERS',
      'DIR_CIV_RETAIL',
      'BR_CIV',
      'SOC_BANK_UEMOA',
    ]);
  });

  it('every codeStructure matches the [A-Z0-9_-]+ pattern', () => {
    for (const s of STRUCTURES_INITIALES) {
      expect(s.codeStructure).toMatch(/^[A-Z0-9_-]+$/);
    }
  });
});
