import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * Lot 8.7.A — extension du calendrier sur une plage d'années.
 *
 * Réutilise la logique pure `generateTempsRows` du seed (`temps-seed.ts`)
 * pour générer les jours manquants puis les insère en ON CONFLICT DO NOTHING
 * (idempotent : ré-étendre une plage déjà couverte n'ajoute rien).
 *
 * La cohérence `anneeFin >= anneeDebut` est revérifiée côté service
 * (BadRequestException) en plus des bornes ci-dessous.
 */
export class ExtendCalendrierDto {
  @ApiProperty({ example: 2031, minimum: 2020, maximum: 2050 })
  @IsInt()
  @Min(2020)
  @Max(2050)
  anneeDebut!: number;

  @ApiProperty({ example: 2032, minimum: 2020, maximum: 2050 })
  @IsInt()
  @Min(2020)
  @Max(2050)
  anneeFin!: number;

  @ApiPropertyOptional({
    example: 2031,
    minimum: 2020,
    maximum: 2050,
    description:
      'Exercice fiscal à forcer sur tous les jours générés. Si omis, exercice_fiscal = année civile (convention UEMOA).',
  })
  @IsOptional()
  @IsInt()
  @Min(2020)
  @Max(2050)
  exerciceFiscal?: number;
}
