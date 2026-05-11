/**
 * Politique mot de passe MIZNAS (Lot 6.4.A).
 *
 * Règles cumulatives (toutes obligatoires) :
 *  - longueur >= 12
 *  - >= 1 majuscule
 *  - >= 1 minuscule
 *  - >= 1 chiffre
 *  - >= 1 caractère spécial (non alphanumérique)
 *
 * Le validator est exposé en 2 formes :
 *  - `validatePasswordPolicy(mdp)` : fonction pure utilisable en
 *    service (changerMdp, reset password admin) — retourne la
 *    liste des erreurs en français.
 *  - décorateur class-validator `@MotDePasseValide()` : à apposer
 *    sur les champs DTO (PATCH /me/password, etc.).
 */
import { randomBytes } from 'node:crypto';
import {
  registerDecorator,
  type ValidationArguments,
  type ValidationOptions,
} from 'class-validator';

export const PASSWORD_MIN_LENGTH = 12;

const REGEX_MAJUSCULE = /[A-Z]/;
const REGEX_MINUSCULE = /[a-z]/;
const REGEX_CHIFFRE = /[0-9]/;
const REGEX_SPECIAL = /[^A-Za-z0-9]/;

export interface PasswordPolicyResult {
  ok: boolean;
  erreurs: string[];
}

export function validatePasswordPolicy(mdp: string): PasswordPolicyResult {
  const erreurs: string[] = [];
  if (typeof mdp !== 'string' || mdp.length < PASSWORD_MIN_LENGTH) {
    erreurs.push(`Mot de passe : minimum ${PASSWORD_MIN_LENGTH} caractères.`);
  }
  if (!REGEX_MAJUSCULE.test(mdp)) {
    erreurs.push('Mot de passe : au moins 1 majuscule requise.');
  }
  if (!REGEX_MINUSCULE.test(mdp)) {
    erreurs.push('Mot de passe : au moins 1 minuscule requise.');
  }
  if (!REGEX_CHIFFRE.test(mdp)) {
    erreurs.push('Mot de passe : au moins 1 chiffre requis.');
  }
  if (!REGEX_SPECIAL.test(mdp)) {
    erreurs.push(
      'Mot de passe : au moins 1 caractère spécial requis (ex: !@#$%).',
    );
  }
  return { ok: erreurs.length === 0, erreurs };
}

// ─── Génération de mot de passe temporaire (Lot 6.4.C) ─────────────

/**
 * Alphabets utilisés pour la génération de mot de passe temporaire.
 * Les caractères ambigus (0/O, 1/I/l) sont volontairement exclus pour
 * limiter les erreurs de saisie en lecture du mail.
 */
const ALPHA_MAJUSCULE = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const ALPHA_MINUSCULE = 'abcdefghijkmnpqrstuvwxyz';
const ALPHA_CHIFFRE = '23456789';
const ALPHA_SPECIAL = '!@#$%&*?';
const ALPHA_TOUS =
  ALPHA_MAJUSCULE + ALPHA_MINUSCULE + ALPHA_CHIFFRE + ALPHA_SPECIAL;

function pickChar(alphabet: string): string {
  const idx = randomBytes(1)[0] % alphabet.length;
  return alphabet[idx];
}

/**
 * Génère un mot de passe temporaire conforme à la politique. Garantit
 * au moins 1 caractère de chaque catégorie (maj/min/chiffre/spécial)
 * en piochant 1 char par catégorie puis en complétant avec
 * `longueur - 4` chars random dans l'alphabet complet ; la chaîne
 * finale est mélangée pour ne pas avoir un préfixe prévisible.
 *
 * Default 32 chars (mandat Lot 6.4.C). Source : `node:crypto.randomBytes`
 * (sécurisé, pas Math.random).
 */
export function genererMotDePasseTemporaire(longueur = 32): string {
  if (longueur < PASSWORD_MIN_LENGTH) {
    throw new Error(
      `genererMotDePasseTemporaire : longueur (${String(longueur)}) doit être >= ${String(PASSWORD_MIN_LENGTH)}.`,
    );
  }
  const chars: string[] = [
    pickChar(ALPHA_MAJUSCULE),
    pickChar(ALPHA_MINUSCULE),
    pickChar(ALPHA_CHIFFRE),
    pickChar(ALPHA_SPECIAL),
  ];
  for (let i = 4; i < longueur; i++) {
    chars.push(pickChar(ALPHA_TOUS));
  }
  // Fisher-Yates shuffle avec randomBytes pour ne pas figer l'ordre
  // maj-min-chiffre-spécial-... au début.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomBytes(1)[0] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

/**
 * Décorateur class-validator : `@MotDePasseValide()`. Concatène les
 * messages d'erreur si plusieurs règles violées.
 */
export function MotDePasseValide(
  options?: ValidationOptions,
): PropertyDecorator {
  return (object: object, propertyName: string | symbol): void => {
    registerDecorator({
      name: 'motDePasseValide',
      target: object.constructor,
      propertyName: String(propertyName),
      options,
      validator: {
        validate(value: unknown): boolean {
          if (typeof value !== 'string') return false;
          return validatePasswordPolicy(value).ok;
        },
        defaultMessage(args: ValidationArguments): string {
          const value = (args.value as string | undefined) ?? '';
          return validatePasswordPolicy(value).erreurs.join(' ');
        },
      },
    });
  };
}
