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

import type { TypeProduit } from '../entities/dim-produit.entity';

const TYPE_PRODUIT_VALUES: readonly TypeProduit[] = [
  'credit',
  'depot',
  'service',
  'marche',
  'autre',
];

export class ListProduitsQueryDto {
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

  @ApiPropertyOptional({ enum: TYPE_PRODUIT_VALUES, example: 'credit' })
  @IsOptional()
  @IsIn(TYPE_PRODUIT_VALUES as readonly string[])
  typeProduit?: TypeProduit;

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
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return -- @Transform({ value }) impose any (signature class-transformer)
    return value;
  })
  @IsBoolean()
  versionCouranteUniquement: boolean = true;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value === 'boolean') return value;
    if (value === 'true') return true;
    if (value === 'false') return false;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return -- @Transform({ value }) impose any (signature class-transformer)
    return value;
  })
  @IsBoolean()
  estPorteurInterets?: boolean;
}
