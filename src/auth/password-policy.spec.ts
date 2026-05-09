import { validatePasswordPolicy, PASSWORD_MIN_LENGTH } from './password-policy';

describe('validatePasswordPolicy', () => {
  it('accepte un mot de passe conforme', () => {
    const r = validatePasswordPolicy('Conforme123!miznas');
    expect(r.ok).toBe(true);
    expect(r.erreurs).toEqual([]);
  });

  it(`refuse un mdp < ${PASSWORD_MIN_LENGTH} caractères`, () => {
    const r = validatePasswordPolicy('Aa1!short');
    expect(r.ok).toBe(false);
    expect(r.erreurs.some((e) => e.includes('minimum'))).toBe(true);
  });

  it('refuse un mdp sans majuscule', () => {
    const r = validatePasswordPolicy('aaaaaaaaaaa1!');
    expect(r.ok).toBe(false);
    expect(r.erreurs.some((e) => e.includes('majuscule'))).toBe(true);
  });

  it('refuse un mdp sans minuscule', () => {
    const r = validatePasswordPolicy('AAAAAAAAAAAA1!');
    expect(r.ok).toBe(false);
    expect(r.erreurs.some((e) => e.includes('minuscule'))).toBe(true);
  });

  it('refuse un mdp sans chiffre', () => {
    const r = validatePasswordPolicy('AaaaaaaaaaaaA!');
    expect(r.ok).toBe(false);
    expect(r.erreurs.some((e) => e.includes('chiffre'))).toBe(true);
  });

  it('refuse un mdp sans caractère spécial', () => {
    const r = validatePasswordPolicy('Aaaaaaaaaaaa1A');
    expect(r.ok).toBe(false);
    expect(r.erreurs.some((e) => e.includes('spécial'))).toBe(true);
  });

  it('cumule les erreurs si plusieurs règles violées', () => {
    const r = validatePasswordPolicy('aaaa');
    expect(r.ok).toBe(false);
    // Trop court + pas de majuscule + pas de chiffre + pas de spécial = 4 erreurs.
    expect(r.erreurs.length).toBeGreaterThanOrEqual(4);
  });

  it('refuse une valeur non-string', () => {
    const r = validatePasswordPolicy(undefined as unknown as string);
    expect(r.ok).toBe(false);
  });
});
