import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import type { ModeSaisieFaitBudget } from '../entities/fait-budget.entity';

/**
 * Vue compacte d'une dimension référencée — embarquée dans la
 * réponse fait pour épargner aux clients un appel par dimension.
 */
export class FaitBudgetDimensionRef {
  @ApiProperty({ example: '42' })
  id!: string;

  @ApiProperty({ example: '611100' })
  code!: string;

  @ApiProperty({ example: 'Salaires bruts' })
  libelle!: string;
}

export class FaitBudgetTempsRef {
  @ApiProperty({ example: '123' })
  id!: string;

  @ApiProperty({ example: '2026-04-01', format: 'date' })
  date!: string;

  @ApiProperty({ example: 4 })
  mois!: number;

  @ApiProperty({ example: 2026 })
  annee!: number;
}

export class FaitBudgetResponseDto {
  @ApiProperty({ example: '7' })
  id!: string;

  @ApiProperty({ example: '123' })
  fkTemps!: string;

  @ApiProperty({ example: '42' })
  fkCompte!: string;

  @ApiProperty({ example: '7' })
  fkStructure!: string;

  @ApiProperty({ example: '12' })
  fkCentre!: string;

  @ApiProperty({ example: '5' })
  fkLigneMetier!: string;

  @ApiProperty({ example: '8' })
  fkProduit!: string;

  @ApiProperty({ example: '3' })
  fkSegment!: string;

  @ApiProperty({ example: '1' })
  fkDevise!: string;

  @ApiProperty({ example: '2' })
  fkVersion!: string;

  @ApiProperty({ example: '1' })
  fkScenario!: string;

  @ApiProperty({ example: 1000000.0 })
  montantDevise!: number;

  @ApiProperty({ example: 1000000.0 })
  montantFcfa!: number;

  @ApiProperty({ example: 1.0 })
  tauxChangeApplique!: number;

  // ─── Mode de saisie (Lot 3.1)

  @ApiProperty({ enum: ['MONTANT', 'ENCOURS_TIE'], example: 'MONTANT' })
  modeSaisie!: ModeSaisieFaitBudget;

  @ApiPropertyOptional({ example: 896000000, nullable: true })
  encoursMoyen!: number | null;

  @ApiPropertyOptional({ example: 0.085, nullable: true })
  tie!: number | null;

  @ApiPropertyOptional({
    example: 'Hypothèse encours retail PCT — comité ALCO mars 2026',
    nullable: true,
  })
  commentaire!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  dateCreation!: Date;

  @ApiProperty({ example: 'admin@miznas.local' })
  utilisateurCreation!: string;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  dateModification!: Date | null;

  @ApiPropertyOptional({ example: 'admin@miznas.local', nullable: true })
  utilisateurModification!: string | null;

  // ─── Relations résumées (chargées par la requête)

  @ApiPropertyOptional({ type: FaitBudgetTempsRef })
  temps?: FaitBudgetTempsRef;

  @ApiPropertyOptional({ type: FaitBudgetDimensionRef })
  compte?: FaitBudgetDimensionRef;

  @ApiPropertyOptional({ type: FaitBudgetDimensionRef })
  structure?: FaitBudgetDimensionRef;

  @ApiPropertyOptional({ type: FaitBudgetDimensionRef })
  centre?: FaitBudgetDimensionRef;

  @ApiPropertyOptional({ type: FaitBudgetDimensionRef })
  ligneMetier?: FaitBudgetDimensionRef;

  @ApiPropertyOptional({ type: FaitBudgetDimensionRef })
  produit?: FaitBudgetDimensionRef;

  @ApiPropertyOptional({ type: FaitBudgetDimensionRef })
  segment?: FaitBudgetDimensionRef;

  @ApiPropertyOptional({ type: FaitBudgetDimensionRef })
  devise?: FaitBudgetDimensionRef;

  @ApiPropertyOptional({ type: FaitBudgetDimensionRef })
  version?: FaitBudgetDimensionRef;

  @ApiPropertyOptional({ type: FaitBudgetDimensionRef })
  scenario?: FaitBudgetDimensionRef;
}
