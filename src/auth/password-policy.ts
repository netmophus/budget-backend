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
