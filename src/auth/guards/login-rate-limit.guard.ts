/**
 * LoginRateLimitGuard (Lot 6.4.B) — applique LoginRateLimiterService
 * sur POST /auth/login uniquement (via @UseGuards). N'est PAS un
 * APP_GUARD global — on ne veut pas rate-limiter les autres routes.
 *
 * Sur blocage :
 *  - audit_log entry `LOGIN_RATE_LIMITED` avec email tenté + IP +
 *    motif (l'email n'est pas validé contre la base, on trace la
 *    valeur exacte tentée — cohérent avec la sécu : on veut voir les
 *    bruteforce sur emails fantaisistes).
 *  - header HTTP `Retry-After` (en secondes).
 *  - throw HttpException(429) avec `code: 'LOGIN_RATE_LIMITED'`
 *    (préservé via AllExceptionsFilter en `errorCode`).
 */
import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { AuditService } from '../../audit/audit.service';
import { LoginRateLimiterService } from '../login-rate-limiter.service';

interface LoginBody {
  email?: string;
}

@Injectable()
export class LoginRateLimitGuard implements CanActivate {
  constructor(
    private readonly limiter: LoginRateLimiterService,
    private readonly auditService: AuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();

    const ip = req.ip ?? 'unknown';
    const body = (req.body as LoginBody | undefined) ?? {};
    const email = (body.email ?? '').trim();

    // Si l'email est absent, on laisse passer — ValidationPipe
    // rejettera avec 400 et on évite de polluer le compteur avec des
    // tentatives sans payload.
    if (!email) return true;

    const result = this.limiter.enregistrerEtVerifier(ip, email);
    if (!result.bloque) return true;

    const userAgent = (req.headers['user-agent'] ?? null) as string | null;
    await this.auditService.log({
      utilisateur: email,
      ipSource: ip,
      userAgent,
      typeAction: 'LOGIN_RATE_LIMITED',
      entiteCible: 'auth',
      statut: 'failure',
      commentaire: `Rate limit dépassé (motif=${result.motif}, retry après ${String(result.retryAfterSeconds)}s).`,
    });

    res.setHeader('Retry-After', String(result.retryAfterSeconds ?? 60));
    throw new HttpException(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        code: 'LOGIN_RATE_LIMITED',
        message: `Trop de tentatives de connexion. Réessayez dans ${String(result.retryAfterSeconds)} secondes.`,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
