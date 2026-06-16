import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Lot 8.7.A — payload d'édition d'un jour du calendrier.
 *
 * Seuls les champs « métier modifiables » sont exposés : statut ouvré,
 * drapeaux de fin de période et libellé du férié. Les colonnes calculées
 * (date, annee, trimestre, mois, jour, semaine_iso, libelle_mois) et
 * exercice_fiscal (sensible pour mv_indicateurs_budget) ne sont JAMAIS
 * acceptées — le whitelist DTO les ignore silencieusement.
 */
export class UpdateJourDto {
  @ApiPropertyOptional({
    example: false,
    description: 'Jour ouvré (true) ou férié/chômé (false).',
  })
  @IsOptional()
  @IsBoolean()
  jourOuvre?: boolean;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  estFinDeMois?: boolean;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  estFinDeTrimestre?: boolean;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  estFinDAnnee?: boolean;

  @ApiPropertyOptional({
    example: 'Tabaski 2027',
    nullable: true,
    description: 'Libellé du jour férié. null pour effacer.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  libelleJour?: string | null;
}
