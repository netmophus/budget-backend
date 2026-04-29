import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

import type { TypeTaux } from '../entities/ref-taux-change.entity';

const TYPE_TAUX_VALUES: readonly TypeTaux[] = [
  'cloture',
  'moyen_mensuel',
  'fixe_budgetaire',
];

/**
 * Le DTO accepte un `codeDevise` (ISO 3) et une `date` (YYYY-MM-DD)
 * que le service résout en `fkDevise` / `fkTemps`. C'est plus
 * ergonomique côté API qu'imposer les ids techniques.
 */
export class CreateTauxChangeDto {
  @ApiProperty({ example: 'EUR', description: 'Code ISO 4217 (3 lettres).' })
  @IsString()
  @MaxLength(3)
  codeDevise!: string;

  @ApiProperty({
    example: '2026-03-31',
    description: 'Date de cotation (YYYY-MM-DD).',
  })
  @IsDateString()
  date!: string;

  @ApiProperty({
    example: 655.957,
    description: '1 unité de devise = X FCFA. Strictement positif.',
  })
  @IsNumber({ maxDecimalPlaces: 8 })
  @Min(0.00000001)
  tauxVersPivot!: number;

  @ApiPropertyOptional({ example: 'BCEAO', default: 'BCEAO', maxLength: 50 })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  source?: string;

  @ApiProperty({ enum: TYPE_TAUX_VALUES, example: 'cloture' })
  @IsIn(TYPE_TAUX_VALUES as readonly string[])
  typeTaux!: TypeTaux;
}
