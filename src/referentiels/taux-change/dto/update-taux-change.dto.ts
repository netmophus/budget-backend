import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Pas de modification de `fkDevise` / `fkTemps` / `typeTaux` (clés
 * du triplet d'unicité — `ref_taux_change` est immuable sur ces 3
 * colonnes ; pour changer la cible, il faut DELETE + INSERT).
 *
 * Seuls `tauxVersPivot` et `source` sont modifiables (correction
 * d'erreur de saisie post-création).
 */
export class UpdateTauxChangeDto {
  @ApiPropertyOptional({ example: 656.0, description: '1 unité = X FCFA' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 8 })
  @Min(0.00000001)
  tauxVersPivot?: number;

  @ApiPropertyOptional({ example: 'BCEAO', maxLength: 50 })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  source?: string;
}
