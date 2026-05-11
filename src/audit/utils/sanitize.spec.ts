import { sanitize } from './sanitize';

describe('sanitize', () => {
  it('redacts password-like keys at any depth (snake/camel/dashed)', () => {
    const input = {
      email: 'a@b.c',
      mot_de_passe: 'secret1',
      motDePasse: 'secret2',
      password: 'secret3',
      mot_de_passe_hash: '$2b$...',
      nested: {
        access_token: 'tok',
        refreshToken: 'tok',
        ok: 'visible',
      },
      list: [{ token: 't', clear: 'v' }],
    };
    const out = sanitize(input) as Record<string, unknown>;
    expect(out.email).toBe('a@b.c');
    expect(out.mot_de_passe).toBe('***REDACTED***');
    expect(out.motDePasse).toBe('***REDACTED***');
    expect(out.password).toBe('***REDACTED***');
    expect(out.mot_de_passe_hash).toBe('***REDACTED***');
    const nested = out.nested as Record<string, unknown>;
    expect(nested.access_token).toBe('***REDACTED***');
    expect(nested.refreshToken).toBe('***REDACTED***');
    expect(nested.ok).toBe('visible');
    const list = out.list as Array<Record<string, unknown>>;
    expect(list[0].token).toBe('***REDACTED***');
    expect(list[0].clear).toBe('v');
  });

  it('returns primitives untouched', () => {
    expect(sanitize(null)).toBeNull();
    expect(sanitize(undefined)).toBeUndefined();
    expect(sanitize(42)).toBe(42);
    expect(sanitize('plain')).toBe('plain');
  });

  it('preserves Date and Buffer instances', () => {
    const d = new Date();
    expect(sanitize(d)).toBe(d);
  });

  it('redacts authorization / cookie headers', () => {
    const out = sanitize({
      headers: {
        Authorization: 'Bearer abc',
        cookie: 'session=xyz',
        host: 'localhost',
      },
    }) as { headers: Record<string, unknown> };
    expect(out.headers.Authorization).toBe('***REDACTED***');
    expect(out.headers.cookie).toBe('***REDACTED***');
    expect(out.headers.host).toBe('localhost');
  });
});
