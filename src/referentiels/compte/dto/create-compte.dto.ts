import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import type { SensCompte } from '../entities/dim-compte.entity';

const SENS_VALUES: readonly SensCompte[] = ['D', 'C', 'M'];

export class CreateCompteDto {
  @ApiProperty({
    example: '601100',
    description: 'Business key — code numérique PCB révisé.',
  })
  @IsString()
  @MaxLength(20)
  @Matches(/^[0-9]+$/, { message: 'codeCompte doit être numérique' })
  codeCompte!: string;

  @ApiProperty({ example: 'Fournitures de bureau', maxLength: 200 })
  @IsString()
  @MaxLength(200)
  libelle!: string;

  @ApiProperty({ example: 6, minimum: 1, maximum: 9 })
  @IsInt()
  @Min(1)
  @Max(9)
  classe!: number;

  @ApiPropertyOptional({ example: '60', maxLength: 20 })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  sousClasse?: string;

  @ApiPropertyOptional({
    example: '12',
    description: 'Surrogate key du compte parent (version courante).',
  })
  @IsOptional()
  @IsString()
  fkCompteParent?: string;

  @ApiPropertyOptional({
    example: '601',
    description: 'Business key du compte parent. Résolu côté service.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  codeCompteParent?: string;

  @ApiProperty({ example: 4, minimum: 1, maximum: 4 })
  @IsInt()
  @Min(1)
  @Max(4)
  niveau!: number;

  @ApiPropertyOptional({ enum: SENS_VALUES, example: 'D' })
  @IsOptional()
  @IsIn(SENS_VALUES as readonly string[])
  sens?: SensCompte;

  @ApiPropertyOptional({ example: 'ACHATS_DIVERS', maxLength: 50 })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  codePosteBudgetaire?: string;

  @ApiPropertyOptional({ example: false, default: false })
  @IsOptional()
  @IsBoolean()
  estCompteCollectif?: boolean;

  @ApiPropertyOptional({ example: false, default: false })
  @IsOptional()
  @IsBoolean()
  estPorteurInterets?: boolean;
}
