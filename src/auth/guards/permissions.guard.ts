import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AuditService } from '../../audit/audit.service';
import type { AuthUser } from '../decorators/current-user.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import {
  PERMISSIONS_KEY,
  PermissionsMetadata,
} from '../decorators/require-permissions.decorator';
import {
  EffectivePermission,
  PermissionsService,
} from '../permissions.service';

interface AuthenticatedRequest extends Request {
  user?: AuthUser & { permissions?: EffectivePermission[] };
}

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissionsService: PermissionsService,
    private readonly config: ConfigService,
    private readonly auditService: AuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const meta = this.reflector.getAllAndOverride<PermissionsMetadata>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!meta) {
      // Endpoint authenticated mais sans @RequirePermissions :
      // l'authentification suffit (gérée en amont par JwtAuthGuard).
      return true;
    }

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = req.user;
    if (!user) {
      throw new UnauthorizedException();
    }

    const effective = await this.permissionsService.getEffectivePermissions(
      user.userId,
    );
    const possessed = new Set(effective.map((p) => p.code_permission));

    const allowed =
      meta.mode === 'all'
        ? meta.permissions.every((p) => possessed.has(p))
        : meta.permissions.some((p) => possessed.has(p));

    if (!allowed) {
      const required = `[${meta.permissions.join(', ')}]`;
      const isProd = this.config.get<string>('NODE_ENV') === 'production';
      const message = isProd
        ? `Permissions insuffisantes : requis ${required}`
        : `Permissions insuffisantes : requis ${required}, possédées [${[
            ...possessed,
          ].join(', ')}]`;

      await this.auditService.log({
        utilisateur: user.email,
        ipSource: (req.ip ?? null) as string | null,
        userAgent:
          (req.headers['user-agent'] as string | undefined) ?? null,
        typeAction: 'PERMISSION_DENIED',
        entiteCible: 'auth',
        idCible: user.userId,
        statut: 'failure',
        commentaire: `Requis: ${required} (mode=${meta.mode}). URL: ${req.method} ${req.url}.`,
      });

      throw new ForbiddenException(message);
    }

    // TODO Lot 2 : ici, croiser perimetre_type / perimetre_id avec
    // l'entité ciblée par la requête (filtrage par structure / CR).
    req.user = { ...user, permissions: effective };

    return true;
  }
}
