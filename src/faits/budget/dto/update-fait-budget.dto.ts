import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, Min } from 'class-validator';

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
}
