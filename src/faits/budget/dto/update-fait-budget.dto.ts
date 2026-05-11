import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import type { ModeSaisieFaitBudget } from '../entities/fait-budget.entity';

/**
 * Seules les 3 mesures sont modifiables. Aucune des 10 FK n'est
 * modifiable par PATCH (un fait modifié structurellement = un
 * fait supprimé + un fait recréé). Le service rejette en 422 si
 * une FK apparaît dans le payload — défense applicative en plus
 * de l'absence de champ FK ici (Whitelist + forbidNonWhitelisted
 * du ValidationPipe global).
 */
export class UpdateFaitBudgetDto {
  @ApiPropertyOptional({ example: 1500000.0 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  montantDevise?: number;

  @ApiPropertyOptional({ example: 1500000.0 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  montantFcfa?: number;

  @ApiPropertyOptional({ example: 1.0 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 8 })
  @Min(0.00000001)
  tauxChangeApplique?: number;

  // ─── Mode de saisie (Lot 3.1)

  @ApiPropertyOptional({
    enum: ['MONTANT', 'ENCOURS_TIE'],
    description:
      'Bascule de mode. Si fourni, le service recalcule `montantDevise` quand ' +
      "le nouveau mode est 'ENCOURS_TIE' et nettoie encoursMoyen/tie quand " +
      "le nouveau mode est 'MONTANT'.",
  })
  @IsOptional()
  @IsIn(['MONTANT', 'ENCOURS_TIE'])
  modeSaisie?: ModeSaisieFaitBudget;

  @ApiPropertyOptional({ example: 896000000 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  encoursMoyen?: number;

  @ApiPropertyOptional({ example: 0.085 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(1)
  tie?: number;

  @ApiPropertyOptional({
    example: 'Révision après comité ALCO Q2',
    maxLength: 2000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  commentaire?: string;
}
