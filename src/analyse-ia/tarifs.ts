/**
 * Tarifs des modèles Claude (USD / million de tokens) — Chantier C1.
 * Sert au calcul de `cout_estime` lors de l'historisation. Extensible.
 */
export const TARIFS_MODELE: Record<string, { in: number; out: number }> = {
  'claude-sonnet-4-6': { in: 3, out: 15 },
  'claude-opus-4-7': { in: 5, out: 25 },
  'claude-opus-4-8': { in: 5, out: 25 },
};

/** Repli si le modèle n'est pas dans la table (tarif Sonnet). */
const TARIF_DEFAUT = { in: 3, out: 15 };

/** Version du template de prompt système en vigueur (traçabilité). */
export const PROMPT_VERSION = 'chantier-a-v1';

/**
 * Coût estimé en USD. Le SDK renvoie souvent un suffixe daté
 * (ex. `claude-sonnet-4-6-20251029`) ou `-mocked` : on matche par préfixe.
 */
export function estimerCoutUsd(
  modele: string,
  tokensIn: number,
  tokensOut: number,
): number {
  const key = Object.keys(TARIFS_MODELE).find((k) => modele.startsWith(k));
  const t = key ? TARIFS_MODELE[key] : TARIF_DEFAUT;
  return (tokensIn / 1_000_000) * t.in + (tokensOut / 1_000_000) * t.out;
}
