import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

import type { CategorieSegment } from '../entities/dim-segment.entity';

const CATEGORIE_VALUES: readonly CategorieSegment[] = [
  'particulier',
  'professionnel',
  'pme',
  'grande_entreprise',
  'institutionnel',
  'secteur_public',
];

/**
 * `codeSegment` est immuable. Sémantique 4-cas (cf. `scd2-pattern.md` §7).
 */
export class UpdateSegmentDto {
  @ApiPropertyOptional({ example: 'PME (rénové)', maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  libelle?: string;

  @ApiPropertyOptional({ enum: CATEGORIE_VALUES })
  @IsOptional()
  @IsIn(CATEGORIE_VALUES as readonly string[])
  categorie?: CategorieSegment;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  estActif?: boolean;
}
