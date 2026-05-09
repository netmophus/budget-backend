import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import { Request } from 'express';

export interface AuthUser {
  userId: string;
  email: string;
  // Lot 6.4.A — flags d'état mot de passe portés par le JWT.
  // `mdpExpire` : date_expiration_mdp est dépassée.
  // `doitChangerMdp` : reset admin ou 1ère connexion forcée.
  // Tant que l'un est true, PasswordExpiredGuard bloque toutes
  // les routes sauf whitelist (/auth/*, /me/password, /health).
  mdpExpire?: boolean;
  doitChangerMdp?: boolean;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const request = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    if (!request.user) {
      throw new Error('CurrentUser used on a non-authenticated request');
    }
    return request.user;
  },
);
