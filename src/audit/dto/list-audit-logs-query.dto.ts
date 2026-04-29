import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

const TYPE_ACTIONS = [
  'LOGIN',
  'LOGIN_FAILED',
  'LOGOUT',
  'REFRESH',
  'REFRESH_FORCED_REVOCATION',
  'CREATE',
  'UPDATE',
  'DELETE',
  'VALIDATE',
  'FREEZE',
  'EXPORT',
  'IMPORT',
  'PERMISSION_DENIED',
  'LIRE_AUDIT',
] as const;

export class ListAuditLogsQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit: number = 50;

  @ApiPropertyOptional({ example: 'admin@miznas.local' })
  @IsOptional()
  @IsString()
  utilisateur?: string;

  @ApiPropertyOptional({ enum: TYPE_ACTIONS })
  @IsOptional()
  @IsIn(TYPE_ACTIONS)
  typeAction?: (typeof TYPE_ACTIONS)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  entiteCible?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  idCible?: string;

  @ApiPropertyOptional({ enum: ['success', 'failure'] })
  @IsOptional()
  @IsIn(['success', 'failure'])
  statut?: 'success' | 'failure';

  @ApiPropertyOptional({ example: '2026-04-28T00:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  dateDebut?: string;

  @ApiPropertyOptional({ example: '2026-04-28T23:59:59.999Z' })
  @IsOptional()
  @IsDateString()
  dateFin?: string;
}
