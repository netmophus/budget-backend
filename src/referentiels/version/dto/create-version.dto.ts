import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
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
 * Pas de `statut` dans le DTO : toute nouvelle version est créée avec
 * `statut = 'ouvert'`. Le workflow de transition est dans le Lot 3.3.
 */
export class CreateVersionDto {
  @ApiProperty({
    example: 'BUDGET_INITIAL_2026',
    description: 'Business key — alphanumérique + underscore.',
  })
  @IsString()
  @MaxLength(50)
  @Matches(/^[A-Z0-9_]+$/, {
    message:
      'codeVersion doit contenir uniquement majuscules, chiffres et underscores',
  })
  codeVersion!: string;

  @ApiProperty({ example: 'Budget initial 2026', maxLength: 200 })
  @IsString()
  @MaxLength(200)
  libelle!: string;

  @ApiProperty({ enum: TYPE_VERSION_VALUES, example: 'budget_initial' })
  @IsIn(TYPE_VERSION_VALUES as readonly string[])
  typeVersion!: TypeVersion;

  @ApiProperty({ example: 2026, minimum: 2020, maximum: 2050 })
  @IsInt()
  @Min(2020)
  @Max(2050)
  exerciceFiscal!: number;

  @ApiPropertyOptional({ example: 'Cadrage initial DG' })
  @IsOptional()
  @IsString()
  commentaire?: string;
}
