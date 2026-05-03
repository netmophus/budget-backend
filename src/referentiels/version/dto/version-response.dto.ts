import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import type {
  StatutVersion,
  TypeVersion,
} from '../entities/dim-version.entity';

export class VersionResponseDto {
  @ApiProperty({ example: '42' })
  id!: string;

  @ApiProperty({ example: 'BUDGET_INITIAL_2026' })
  codeVersion!: string;

  @ApiProperty({ example: 'Budget initial 2026' })
  libelle!: string;

  @ApiProperty({
    enum: ['budget_initial', 'reforecast_1', 'reforecast_2', 'atterrissage'],
  })
  typeVersion!: TypeVersion;

  @ApiProperty({ example: 2026 })
  exerciceFiscal!: number;

  @ApiProperty({ enum: ['ouvert', 'soumis', 'valide', 'gele'] })
  statut!: StatutVersion;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  dateGel!: Date | null;

  @ApiPropertyOptional({ example: 'admin@miznas.local', nullable: true })
  utilisateurGel!: string | null;

  @ApiPropertyOptional({ example: 'Cadrage initial DG', nullable: true })
  commentaire!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  dateCreation!: Date;

  @ApiProperty({ example: 'system' })
  utilisateurCreation!: string;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  dateModification!: Date | null;

  @ApiPropertyOptional({ example: 'admin@miznas.local', nullable: true })
  utilisateurModification!: string | null;
}

/**
 * Réponse étendue exclusive à `POST /versions` — porte le code du
 * scénario auto-créé par le hook Q9 (Lot 3.2) si la création de la
 * version a déclenché l'ajout d'un MEDIAN_<exercice>.
 */
export class CreateVersionResponseDto extends VersionResponseDto {
  @ApiPropertyOptional({
    example: 'MEDIAN_2027',
    nullable: true,
    description:
      "Présent (non null) si la création de la version a déclenché " +
      "le hook Q9 et créé automatiquement un scénario MEDIAN. " +
      "Null sinon (cas d'un exercice ayant déjà au moins un scénario).",
  })
  scenarioAutoCreeCode!: string | null;
}
