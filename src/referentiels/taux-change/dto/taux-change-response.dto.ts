import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import type { TypeTaux } from '../entities/ref-taux-change.entity';

export class TauxChangeDeviseSummaryDto {
  @ApiProperty({ example: '7' })
  id!: string;

  @ApiProperty({ example: 'EUR' })
  codeIso!: string;

  @ApiProperty({ example: 'Euro' })
  libelle!: string;
}

export class TauxChangeTempsSummaryDto {
  @ApiProperty({ example: '123' })
  id!: string;

  @ApiProperty({ example: '2026-03-31', format: 'date' })
  date!: string;
}

export class TauxChangeResponseDto {
  @ApiProperty({ example: '42' })
  id!: string;

  @ApiProperty({ example: '7' })
  fkDevise!: string;

  @ApiProperty({ example: '123' })
  fkTemps!: string;

  @ApiProperty({ example: '655.95700000' })
  tauxVersPivot!: string;

  @ApiProperty({ example: 'BCEAO' })
  source!: string;

  @ApiProperty({ enum: ['cloture', 'moyen_mensuel', 'fixe_budgetaire'] })
  typeTaux!: TypeTaux;

  @ApiPropertyOptional({ type: TauxChangeDeviseSummaryDto })
  devise?: TauxChangeDeviseSummaryDto;

  @ApiPropertyOptional({ type: TauxChangeTempsSummaryDto })
  temps?: TauxChangeTempsSummaryDto;

  @ApiProperty({ type: String, format: 'date-time' })
  dateCreation!: Date;

  @ApiProperty({ example: 'system' })
  utilisateurCreation!: string;
}

/**
 * Réponse de `GET /taux-change/applicable` — taux applicable à une
 * date donnée (date exacte, ou dernier taux antérieur si pas
 * d'exact match).
 */
export class TauxApplicableDto {
  @ApiProperty({ example: '7' })
  fkDevise!: string;

  @ApiProperty({ example: '123' })
  fkTemps!: string;

  @ApiProperty({ example: '655.95700000' })
  tauxVersPivot!: string;

  @ApiProperty({ example: 'BCEAO' })
  source!: string;

  @ApiProperty({ enum: ['cloture', 'moyen_mensuel', 'fixe_budgetaire'] })
  typeTaux!: TypeTaux;

  @ApiProperty({ example: '2026-03-31', format: 'date' })
  dateApplicable!: string;
}
