import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

import type {
  StatutVersion,
  TypeVersion,
} from '../entities/dim-version.entity';

const TYPE_VERSION_VALUES: readonly TypeVersion[] = [
  'budget_initial',
  'reforecast_1',
  'reforecast_2',
  'atterrissage',
];

const STATUT_VERSION_VALUES: readonly StatutVersion[] = [
  'ouvert',
  'soumis',
  'valide',
  'gele',
];

export class ListVersionsQueryDto {
  @ApiPropertyOptional({ example: 1, default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ example: 50, default: 50, minimum: 1, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit: number = 50;

  @ApiPropertyOptional({ example: 2026, minimum: 2020, maximum: 2050 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2020)
  @Max(2050)
  exerciceFiscal?: number;

  @ApiPropertyOptional({ enum: STATUT_VERSION_VALUES })
  @IsOptional()
  @IsIn(STATUT_VERSION_VALUES as readonly string[])
  statut?: StatutVersion;

  @ApiPropertyOptional({ enum: TYPE_VERSION_VALUES })
  @IsOptional()
  @IsIn(TYPE_VERSION_VALUES as readonly string[])
  typeVersion?: TypeVersion;
}
