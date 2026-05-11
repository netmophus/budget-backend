import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  Min,
} from 'class-validator';

import {
  CODES_PAYS_UEMOA,
  TYPES_STRUCTURE,
} from '../entities/dim-structure.entity';
import type {
  CodePaysUemoa,
  TypeStructure,
} from '../entities/dim-structure.entity';

/**
 * `codeStructure` est volontairement absent : la business key est
 * immuable. Les autres champs sont optionnels — la sémantique du
 * service distingue les changements SCD2-tracés (nouvelle version)
 * du toggle `estActif` seul (mise à jour en place).
 */
export class UpdateStructureDto {
  @ApiPropertyOptional({
    example: 'Agence Abidjan Plateau (rénovée)',
    maxLength: 200,
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  libelle?: string;

  @ApiPropertyOptional({ example: 'Ag. Plateau', maxLength: 50 })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  libelleCourt?: string;

  @ApiPropertyOptional({ enum: TYPES_STRUCTURE })
  @IsOptional()
  @IsEnum(TYPES_STRUCTURE)
  typeStructure?: TypeStructure;

  @ApiPropertyOptional({ example: 5, minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  niveauHierarchique?: number;

  @ApiPropertyOptional({ example: '12' })
  @IsOptional()
  @IsString()
  fkStructureParent?: string;

  @ApiPropertyOptional({ enum: CODES_PAYS_UEMOA })
  @IsOptional()
  @IsString()
  @Length(3, 3)
  @IsIn(CODES_PAYS_UEMOA as readonly string[])
  codePays?: CodePaysUemoa;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  estActif?: boolean;
}
