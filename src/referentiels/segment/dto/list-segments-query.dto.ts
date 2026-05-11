import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import type { CategorieSegment } from '../entities/dim-segment.entity';

const CATEGORIE_VALUES: readonly CategorieSegment[] = [
  'particulier',
  'professionnel',
  'pme',
  'grande_entreprise',
  'institutionnel',
  'secteur_public',
];

export class ListSegmentsQueryDto {
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

  @ApiPropertyOptional({ enum: CATEGORIE_VALUES })
  @IsOptional()
  @IsIn(CATEGORIE_VALUES as readonly string[])
  categorie?: CategorieSegment;

  @ApiPropertyOptional({
    description: 'Filtre LIKE %libelle% case-insensitive.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @ApiPropertyOptional({ example: true, default: true })
  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value === 'boolean') return value;
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  @IsBoolean()
  versionCouranteUniquement: boolean = true;
}
