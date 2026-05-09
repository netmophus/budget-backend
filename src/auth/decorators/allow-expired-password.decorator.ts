import { SetMetadata } from '@nestjs/common';

/**
 * Marque une route comme accessible même si le JWT contient les
 * flags `mdpExpire` ou `doitChangerMdp` (Lot 6.4.A).
 *
 * À apposer sur :
 *  - PATCH /me/password (changement obligatoire)
 *  - GET /auth/me (le user doit pouvoir consulter son profil pour
 *    afficher la page de changement de mdp)
 *  - POST /auth/logout (le user doit pouvoir se déconnecter même
 *    coincé)
 *
 * Le `@Public()` decorator existant sert pour les endpoints
 * non-authentifiés (login, refresh) — il bypass déjà tous les
 * guards. `@AllowExpiredPassword()` est uniquement pour les routes
 * AUTHENTIFIÉES qui doivent rester accessibles avec un mdp expiré.
 */
export const ALLOW_EXPIRED_PASSWORD_KEY = 'allowExpiredPassword';

export const AllowExpiredPassword = (): MethodDecorator & ClassDecorator =>
  SetMetadata(ALLOW_EXPIRED_PASSWORD_KEY, true);
