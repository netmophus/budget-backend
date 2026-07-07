import { estimerCoutUsd } from './tarifs';

describe('estimerCoutUsd (Chantier C1)', () => {
  it('Sonnet 4.6 : 3$/M in + 15$/M out', () => {
    // 1M in + 1M out -> 3 + 15 = 18
    expect(
      estimerCoutUsd('claude-sonnet-4-6', 1_000_000, 1_000_000),
    ).toBeCloseTo(18, 5);
  });

  it('Opus 4.7 : 5$/M in + 25$/M out', () => {
    expect(estimerCoutUsd('claude-opus-4-7', 1_000_000, 1_000_000)).toBeCloseTo(
      30,
      5,
    );
  });

  it('matche par préfixe (suffixe daté / -mocked)', () => {
    expect(
      estimerCoutUsd('claude-sonnet-4-6-20251029', 2_000_000, 0),
    ).toBeCloseTo(6, 5);
    expect(estimerCoutUsd('claude-sonnet-4-6-mocked', 0, 0)).toBe(0);
  });

  it('modèle inconnu → tarif Sonnet par défaut', () => {
    expect(estimerCoutUsd('modele-x', 1_000_000, 0)).toBeCloseTo(3, 5);
  });
});
