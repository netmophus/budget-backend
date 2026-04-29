import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

import {
  CODES_PAYS_UEMOA,
  CodePaysUemoa,
  TYPES_STRUCTURE,
  TypeStructure,
} from '../entities/dim-structure.entity';

export class CreateStructureDto {
  @ApiProperty({
    example: 'AG_ABJ_PLATEAU',
    description: 'Business key — code stable inter-versions ([A-Z0-9_-]+).',
  })
  @IsString()
  @MaxLength(50)
  @Matches(/^[A-Z0-9_-]+$/, {
    message: 'codeStructure doit être en MAJUSCULES, chiffres, _ ou -',
  })
  codeStructure!: string;

  @ApiProperty({ example: 'Agence Abidjan Plateau', maxLength: 200 })
  @IsString()
  @MaxLength(200)
  libelle!: string;

  @ApiPropertyOptional({ example: 'Ag. Plateau', maxLength: 50 })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  libelleCourt?: string;

  @ApiProperty({ enum: TYPES_STRUCTURE, example: 'agence' })
  @IsEnum(TYPES_STRUCTURE)
  typeStructure!: TypeStructure;

  @ApiProperty({ example: 5, minimum: 1 })
  @IsInt()
  @Min(1)
  niveauHierarchique!: number;

  @ApiPropertyOptional({
    example: '12',
    description: 'Surrogate key du parent (version courante).',
  })
  @IsOptional()
  @IsString()
  fkStructureParent?: string;

  @ApiPropertyOptional({ enum: CODES_PAYS_UEMOA, example: 'CIV' })
  @IsOptional()
  @IsString()
  @Length(3, 3)
  @IsIn(CODES_PAYS_UEMOA as readonly string[])
  codePays?: CodePaysUemoa;
}
