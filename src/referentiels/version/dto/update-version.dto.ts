import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import type { TypeVersion } from '../entities/dim-version.entity';

const TYPE_VERSION_VALUES: readonly TypeVersion[] = [
  'budget_initial',
  'reforecast_1',
  'reforecast_2',
  'atterrissage',
];

/**
 * `codeVersion` est immuable. `statut` n'est PAS exposé : transitions
 * réservées au workflow Lot 3.3 (soumettre / valider / geler).
 *
 * Modification autorisée UNIQUEMENT tant que `statut = 'ouvert'` —
 * vérifié côté service (409 Conflict sinon).
 */
export class UpdateVersionDto {
  @ApiPropertyOptional({ example: 'Budget initial 2026 — V2' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  libelle?: string;

  @ApiPropertyOptional({ enum: TYPE_VERSION_VALUES })
  @IsOptional()
  @IsIn(TYPE_VERSION_VALUES as readonly string[])
  typeVersion?: TypeVersion;

  @ApiPropertyOptional({ example: 2026, minimum: 2020, maximum: 2050 })
  @IsOptional()
  @IsInt()
  @Min(2020)
  @Max(2050)
  exerciceFiscal?: number;

  @ApiPropertyOptional({ example: 'Mise à jour cadrage' })
  @IsOptional()
  @IsString()
  commentaire?: string;
}
