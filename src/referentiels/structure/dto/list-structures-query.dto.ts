import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import {
  CODES_PAYS_UEMOA,
  CodePaysUemoa,
  TYPES_STRUCTURE,
  TypeStructure,
} from '../entities/dim-structure.entity';

export class ListStructuresQueryDto {
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

  @ApiPropertyOptional({ enum: CODES_PAYS_UEMOA })
  @IsOptional()
  @IsString()
  @Length(3, 3)
  @IsIn(CODES_PAYS_UEMOA as readonly string[])
  codePays?: CodePaysUemoa;

  @ApiPropertyOptional({ enum: TYPES_STRUCTURE })
  @IsOptional()
  @IsEnum(TYPES_STRUCTURE)
  typeStructure?: TypeStructure;

  @ApiPropertyOptional({ description: 'Filtre LIKE %libelle% case-insensitive.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @ApiPropertyOptional({
    example: true,
    default: true,
    description:
      "Si true (défaut), ne retourne que les versions courantes. Si false, inclut toutes les versions historisées.",
  })
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
