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

import type { TypeProduit } from '../entities/dim-produit.entity';

const TYPE_PRODUIT_VALUES: readonly TypeProduit[] = [
  'credit',
  'depot',
  'service',
  'marche',
  'autre',
];

/**
 * `codeProduit` est immuable. Sémantique 4-cas (cf. `scd2-pattern.md` §7).
 */
export class UpdateProduitDto {
  @ApiPropertyOptional({ example: 'Découverts (rénovés)', maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  libelle?: string;

  @ApiPropertyOptional({ enum: TYPE_PRODUIT_VALUES })
  @IsOptional()
  @IsIn(TYPE_PRODUIT_VALUES as readonly string[])
  typeProduit?: TypeProduit;

  @ApiPropertyOptional({ example: '12' })
  @IsOptional()
  @IsString()
  fkProduitParent?: string;

  @ApiPropertyOptional({ example: 'CREDIT_TRESORERIE' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  codeProduitParent?: string;

  @ApiPropertyOptional({ example: 3, minimum: 1, maximum: 4 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(4)
  niveau?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  estPorteurInterets?: boolean;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  estActif?: boolean;
}
