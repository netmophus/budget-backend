import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { TYPES_CR } from '../entities/dim-centre-responsabilite.entity';
import type { TypeCr } from '../entities/dim-centre-responsabilite.entity';

export class ListCrsQueryDto {
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

  @ApiPropertyOptional({ description: 'Filtre sur le code de la structure parente.' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  codeStructure?: string;

  @ApiPropertyOptional({ enum: TYPES_CR })
  @IsOptional()
  @IsEnum(TYPES_CR)
  typeCr?: TypeCr;

  @ApiPropertyOptional({ description: 'Filtre LIKE %libelle% case-insensitive.' })
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
