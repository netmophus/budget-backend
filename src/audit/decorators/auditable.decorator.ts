import { SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import { TypeAction } from '../entities/audit-log.entity';

export const AUDITABLE_KEY = 'auditable';

export interface AuditableMetadata {
  typeAction: TypeAction;
  entiteCible: string;
  extractIdCible?: (req: Request, response?: unknown) => string | null;
}

export const Auditable = (
  options: AuditableMetadata,
): MethodDecorator & ClassDecorator => SetMetadata(AUDITABLE_KEY, options);
