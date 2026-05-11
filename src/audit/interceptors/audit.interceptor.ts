import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { Observable, from, throwError } from 'rxjs';
import { catchError, mergeMap } from 'rxjs/operators';
import type { AuthUser } from '../../auth/decorators/current-user.decorator';
import { AuditService } from '../audit.service';
import {
  AUDITABLE_KEY,
  AuditableMetadata,
} from '../decorators/auditable.decorator';
import { sanitize } from '../utils/sanitize';

interface AuthedRequest extends Request {
  user?: AuthUser;
}

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly auditService: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const meta = this.reflector.getAllAndOverride<AuditableMetadata>(
      AUDITABLE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!meta) {
      // Pas de @Auditable : pas de coût pour les endpoints non audités.
      return next.handle();
    }

    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const start = Date.now();
    const utilisateur = req.user?.email ?? 'anonymous';
    const ipSource = (req.ip ?? null) as string | null;
    const userAgent =
      (req.headers['user-agent'] as string | undefined) ?? null;

    const baseEntry = {
      utilisateur,
      ipSource,
      userAgent,
      typeAction: meta.typeAction,
      entiteCible: meta.entiteCible,
    };

    const sanitizedBody = sanitize(req.body);

    return next.handle().pipe(
      mergeMap((response: unknown) => {
        const idCible = meta.extractIdCible
          ? (meta.extractIdCible(req, response) ?? null)
          : null;
        return from(
          this.auditService.log({
            ...baseEntry,
            idCible,
            payloadAvant: null,
            payloadApres: sanitize({ body: sanitizedBody, response }),
            statut: 'success',
            dureeMs: Date.now() - start,
          }),
        ).pipe(mergeMap(() => from(Promise.resolve(response))));
      }),
      catchError((err: unknown) => {
        const idCible = meta.extractIdCible
          ? (meta.extractIdCible(req) ?? null)
          : null;
        const message = err instanceof Error ? err.message : String(err);
        return from(
          this.auditService.log({
            ...baseEntry,
            idCible,
            payloadAvant: null,
            payloadApres: sanitize({ body: sanitizedBody }),
            commentaire: message,
            statut: 'failure',
            dureeMs: Date.now() - start,
          }),
        ).pipe(mergeMap(() => throwError(() => err)));
      }),
    );
  }
}
