import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import type { TypeTaux } from '../entities/ref-taux-change.entity';

const TYPE_TAUX_VALUES: readonly TypeTaux[] = [
  'cloture',
  'moyen_mensuel',
  'fixe_budgetaire',
];

export class ListTauxChangeQueryDto {
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

  @ApiPropertyOptional({ example: 'EUR', maxLength: 3 })
  @IsOptional()
  @IsString()
  @MaxLength(3)
  codeDevise?: string;

  @ApiPropertyOptional({ example: '2026-01-01', format: 'date' })
  @IsOptional()
  @IsDateString()
  dateDebut?: string;

  @ApiPropertyOptional({ example: '2026-12-31', format: 'date' })
  @IsOptional()
  @IsDateString()
  dateFin?: string;

  @ApiPropertyOptional({ enum: TYPE_TAUX_VALUES })
  @IsOptional()
  @IsIn(TYPE_TAUX_VALUES as readonly string[])
  typeTaux?: TypeTaux;
}
