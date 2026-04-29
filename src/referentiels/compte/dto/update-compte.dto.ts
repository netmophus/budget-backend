import { ApiPropertyOptional } from '@nestjs/swagger';
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

import type { SensCompte } from '../entities/dim-compte.entity';

const SENS_VALUES: readonly SensCompte[] = ['D', 'C', 'M'];

/**
 * `codeCompte` et `classe` sont immuables. Les autres champs sont
 * optionnels. Sémantique 4-cas (cf. `scd2-pattern.md` §7).
 */
export class UpdateCompteDto {
  @ApiPropertyOptional({ example: 'Fournitures (rénovées)', maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  libelle?: string;

  @ApiPropertyOptional({ maxLength: 20 })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  sousClasse?: string;

  @ApiPropertyOptional({ example: '12' })
  @IsOptional()
  @IsString()
  fkCompteParent?: string;

  @ApiPropertyOptional({ example: '601' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  codeCompteParent?: string;

  @ApiPropertyOptional({ example: 4, minimum: 1, maximum: 4 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(4)
  niveau?: number;

  @ApiPropertyOptional({ enum: SENS_VALUES })
  @IsOptional()
  @IsIn(SENS_VALUES as readonly string[])
  sens?: SensCompte;

  @ApiPropertyOptional({ maxLength: 50 })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  codePosteBudgetaire?: string;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  estCompteCollectif?: boolean;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  estPorteurInterets?: boolean;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  estActif?: boolean;
}
