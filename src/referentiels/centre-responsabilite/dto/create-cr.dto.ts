import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

import { TYPES_CR } from '../entities/dim-centre-responsabilite.entity';
import type { TypeCr } from '../entities/dim-centre-responsabilite.entity';

/**
 * Création d'un CR. La structure parente peut être désignée :
 *  - soit par son surrogate key courant (`fkStructure`) — usage
 *    technique (imports CSV / API back-office) ;
 *  - soit par son code business (`codeStructure`) — usage UI.
 *
 * Au moins un des deux DOIT être fourni. La validation est faite
 * côté service.
 */
export class CreateCrDto {
  @ApiProperty({ example: 'CR_AG_ABJ_PLATEAU' })
  @IsString()
  @MaxLength(50)
  @Matches(/^[A-Z0-9_-]+$/, {
    message: 'codeCr doit être en MAJUSCULES, chiffres, _ ou -',
  })
  codeCr!: string;

  @ApiProperty({ example: 'CR Agence Plateau', maxLength: 200 })
  @IsString()
  @MaxLength(200)
  libelle!: string;

  @ApiPropertyOptional({ example: 'CR Plateau', maxLength: 50 })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  libelleCourt?: string;

  @ApiProperty({ enum: TYPES_CR, example: 'cdp' })
  @IsEnum(TYPES_CR)
  typeCr!: TypeCr;

  @ApiPropertyOptional({
    example: '12',
    description:
      'Surrogate key (id technique) de la structure parente. Préférer codeStructure côté UI.',
  })
  @IsOptional()
  @IsString()
  fkStructure?: string;

  @ApiPropertyOptional({
    example: 'AG_ABJ_PLATEAU',
    description: 'Business key de la structure parente. Résolu côté service.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  codeStructure?: string;
}
