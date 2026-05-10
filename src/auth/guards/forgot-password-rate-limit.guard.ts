/**
 * ForgotPasswordRateLimitGuard (Lot 6.5.A) — applique
 * `LoginRateLimiterService.enregistrerEtVerifierForgot(ip)` sur
 * `POST /auth/forgot-password` (3 tentatives par 15 min par IP).
 *
 * On rate-limite uniquement par IP (pas par email) : l'endpoint
 * forgot-password répond la même chose pour un email connu ou
 * inconnu (anti-énumération), donc rate-limiter par email
 * permettrait à un attaquant de détecter les emails valides en
 * observant le statut 429. Cohérent avec le pattern industriel
 * (Google, GitHub, etc.).
 *
 * Sur blocage :
 *  - audit `LOGIN_RATE_LIMITED` avec entiteCible='forgot-password'
 *  - header HTTP `Retry-After` (en secondes)
 *  - throw 429 avec `code: 'LOGIN_RATE_LIMITED'`
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

interface ForgotBody {
  email?: string;
}

@Injectable()
export class ForgotPasswordRateLimitGuard implements CanActivate {
  constructor(
    private readonly limiter: LoginRateLimiterService,
    private readonly auditService: AuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();

    const ip = req.ip ?? 'unknown';
    const result = this.limiter.enregistrerEtVerifierForgot(ip);
    if (!result.bloque) return true;

    const userAgent = (req.headers['user-agent'] ?? null) as string | null;
    const body = (req.body as ForgotBody | undefined) ?? {};
    const emailTente = (body.email ?? '').trim();

    await this.auditService.log({
      utilisateur: emailTente || 'anonymous',
      ipSource: ip,
      userAgent,
      typeAction: 'LOGIN_RATE_LIMITED',
      entiteCible: 'forgot-password',
      statut: 'failure',
      commentaire: `Forgot-password rate limit dépassé (motif=IP, retry après ${String(result.retryAfterSeconds)}s).`,
    });

    res.setHeader('Retry-After', String(result.retryAfterSeconds ?? 60));
    throw new HttpException(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        code: 'LOGIN_RATE_LIMITED',
        message: `Trop de demandes. Réessayez dans ${String(result.retryAfterSeconds)} secondes.`,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
