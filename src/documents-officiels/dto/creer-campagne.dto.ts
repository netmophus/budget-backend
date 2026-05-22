import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

import type { ModeVisa } from '../entities/campagne-budgetaire.entity';

/**
 * DTO entrée `POST /documents-officiels/campagnes` (Lot 8.1.C).
 *
 * Camelcase conforme au pattern projet (cf. budget/dto/indicateurs.dto.ts).
 * Les `bigint` user.id sont serialises en string par pg → `@IsString`.
 */
export class CreerCampagneDto {
  @ApiProperty({ example: 'CAMPAGNE_2027' })
  @IsString()
  @MaxLength(50)
  code!: string;

  @ApiProperty({ example: 2027 })
  @IsInt()
  @Min(1900)
  exerciceFiscal!: number;

  @ApiProperty({ example: 'Campagne budgétaire 2027' })
  @IsString()
  @MaxLength(255)
  libelle!: string;

  @ApiProperty({ example: '23', description: 'BIGINT user.id stringifié' })
  @IsString()
  fkUserSignataireDefaut!: string;

  @ApiPropertyOptional({
    enum: ['PARALLELE', 'SEQUENTIEL'],
    default: 'PARALLELE',
  })
  @IsOptional()
  @IsIn(['PARALLELE', 'SEQUENTIEL'])
  modeVisaDefaut?: ModeVisa;
}
