import { SCENARIOS_INITIAUX } from './scenario-seed';

describe('scenario-seed (data shape)', () => {
  it('declares exactly 3 scenarios', () => {
    expect(SCENARIOS_INITIAUX).toHaveLength(3);
  });

  it('covers central / optimiste / pessimiste', () => {
    const types = SCENARIOS_INITIAUX.map((s) => s.typeScenario).sort();
    expect(types).toEqual(['central', 'optimiste', 'pessimiste']);
  });

  it('all codes match [A-Z0-9_]+', () => {
    for (const s of SCENARIOS_INITIAUX) {
      expect(s.codeScenario).toMatch(/^[A-Z0-9_]+$/);
    }
  });
});
