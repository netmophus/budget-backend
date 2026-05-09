/**
 * PasswordExpiredGuard (Lot 6.4.A) — bloque toutes les routes
 * authentifiées si le JWT du user contient les flags `mdpExpire`
 * ou `doitChangerMdp`, sauf si la route porte le decorator
 * `@AllowExpiredPassword()`.
 *
 * Réponse en cas de blocage :
 *  - HTTP 403
 *  - Body : { code: 'MDP_EXPIRE' | 'MDP_TEMPORAIRE', message }
 *    Le frontend lit `code` pour rediriger vers /change-mdp.
 *
 * Le user reçoit son JWT au moment du login. Une fois le mdp
 * changé via PATCH /me/password, l'endpoint retourne un nouveau
 * couple access/refresh sans flags — le frontend doit remplacer
 * ses tokens. Tant qu'il garde l'ancien JWT, le guard continue
 * à bloquer (cohérence : le JWT est la source de vérité, pas la DB).
 */
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { ALLOW_EXPIRED_PASSWORD_KEY } from '../decorators/allow-expired-password.decorator';
import type { AuthUser } from '../decorators/current-user.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class PasswordExpiredGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // Routes publiques (login, refresh) : on ne bloque pas — le user
    // n'a même pas encore de JWT.
    const isPublic = this.reflector.getAllAndOverride<boolean>(
      IS_PUBLIC_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (isPublic) return true;

    // Routes whitelistées explicitement (PATCH /me/password etc.).
    const allowExpired = this.reflector.getAllAndOverride<boolean>(
      ALLOW_EXPIRED_PASSWORD_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (allowExpired) return true;

    const req = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const user = req.user;
    // Pas de JWT (ne devrait pas arriver, JwtAuthGuard a précédé) →
    // on laisse passer, le JwtAuthGuard a déjà rejeté.
    if (!user) return true;

    if (user.doitChangerMdp) {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'MDP_TEMPORAIRE',
        message:
          "Mot de passe temporaire — vous devez le changer via " +
          'PATCH /me/password avant tout autre accès.',
      });
    }
    if (user.mdpExpire) {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'MDP_EXPIRE',
        message:
          'Mot de passe expiré — vous devez le renouveler via ' +
          'PATCH /me/password avant tout autre accès.',
      });
    }
    return true;
  }
}
