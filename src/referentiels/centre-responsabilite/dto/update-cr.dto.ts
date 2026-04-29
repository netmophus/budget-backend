import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

import { TYPES_CR } from '../entities/dim-centre-responsabilite.entity';
import type { TypeCr } from '../entities/dim-centre-responsabilite.entity';

/**
 * `codeCr` est immuable (business key). Les autres champs sont
 * optionnels. La distinction SCD2 / in-place / intra-jour est
 * gérée par le service (cf. `scd2-pattern.md` §7).
 */
export class UpdateCrDto {
  @ApiPropertyOptional({ example: 'CR Agence Plateau (V2)', maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  libelle?: string;

  @ApiPropertyOptional({ example: 'CR Plateau', maxLength: 50 })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  libelleCourt?: string;

  @ApiPropertyOptional({ enum: TYPES_CR })
  @IsOptional()
  @IsEnum(TYPES_CR)
  typeCr?: TypeCr;

  @ApiPropertyOptional({ example: '12' })
  @IsOptional()
  @IsString()
  fkStructure?: string;

  @ApiPropertyOptional({ example: 'AG_ABJ_COCODY' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  codeStructure?: string;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  estActif?: boolean;
}
