// Liste des clés dont la valeur doit être masquée dans les payloads d'audit.
// Comparaison normalisée (lower-case, sans underscores ni tirets).
const SECRET_KEYS = new Set([
  'motdepasse',
  'motdepassehash',
  'password',
  'passwordhash',
  'accesstoken',
  'refreshtoken',
  'token',
  'jwt',
  'secret',
  'authorization',
  'cookie',
  'apikey',
]);

const REDACTED = '***REDACTED***';

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[_\-]/g, '');
}

export function sanitize(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;

  if (Array.isArray(value)) {
    return value.map(sanitize);
  }

  // Date / Buffer / etc. : laisser tels quels (jsonb gère via toJSON).
  if (value instanceof Date || value instanceof Buffer) {
    return value;
  }

  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEYS.has(normalizeKey(k))) {
      result[k] = REDACTED;
    } else {
      result[k] = sanitize(v);
    }
  }
  return result;
}
