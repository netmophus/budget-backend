import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import type { ModeSaisieFaitBudget } from '../entities/fait-budget.entity';

/**
 * DTO de création d'un `fait_budget` au Lot 3.2A — l'appelant fournit
 * les 10 FK techniques résolues à la main. Le Lot 3.2B exposera une
 * route additionnelle `/from-business-keys` qui résoudra les FK
 * automatiquement depuis les codes business + date métier (Option B
 * SCD2 — cf. modele-donnees §6.3).
 */
export class CreateFaitBudgetDto {
  // ─── Identification (10 FK)

  @ApiProperty({ example: '123', description: 'fk_temps (id dim_temps)' })
  @IsString()
  @Matches(/^\d+$/, { message: 'fkTemps doit être un bigint' })
  fkTemps!: string;

  @ApiProperty({ example: '42', description: 'fk_compte (id dim_compte)' })
  @IsString()
  @Matches(/^\d+$/, { message: 'fkCompte doit être un bigint' })
  fkCompte!: string;

  @ApiProperty({ example: '7' })
  @IsString()
  @Matches(/^\d+$/, { message: 'fkStructure doit être un bigint' })
  fkStructure!: string;

  @ApiProperty({ example: '12' })
  @IsString()
  @Matches(/^\d+$/, { message: 'fkCentre doit être un bigint' })
  fkCentre!: string;

  @ApiProperty({ example: '5' })
  @IsString()
  @Matches(/^\d+$/, { message: 'fkLigneMetier doit être un bigint' })
  fkLigneMetier!: string;

  @ApiProperty({ example: '8' })
  @IsString()
  @Matches(/^\d+$/, { message: 'fkProduit doit être un bigint' })
  fkProduit!: string;

  @ApiProperty({ example: '3' })
  @IsString()
  @Matches(/^\d+$/, { message: 'fkSegment doit être un bigint' })
  fkSegment!: string;

  @ApiProperty({ example: '1' })
  @IsString()
  @Matches(/^\d+$/, { message: 'fkDevise doit être un bigint' })
  fkDevise!: string;

  @ApiProperty({ example: '2' })
  @IsString()
  @Matches(/^\d+$/, { message: 'fkVersion doit être un bigint' })
  fkVersion!: string;

  @ApiProperty({ example: '1' })
  @IsString()
  @Matches(/^\d+$/, { message: 'fkScenario doit être un bigint' })
  fkScenario!: string;

  // ─── Mesures

  @ApiProperty({
    example: 1000000.0,
    description: "Montant en devise d'origine.",
  })
  @IsNumber({ maxDecimalPlaces: 4 })
  montantDevise!: number;

  @ApiProperty({
    example: 1000000.0,
    description:
      'Montant converti en FCFA (= montantDevise × tauxChangeApplique). Au Lot 3.2A, le caller fournit la valeur ; le calcul automatique arrive en Lot 3.2B.',
  })
  @IsNumber({ maxDecimalPlaces: 4 })
  montantFcfa!: number;

  @ApiProperty({
    example: 1.0,
    description:
      'Taux appliqué (1 unité de devise = X FCFA). Pour la devise pivot (XOF), 1.0.',
  })
  @IsNumber({ maxDecimalPlaces: 8 })
  @Min(0.00000001)
  tauxChangeApplique!: number;

  // ─── Mode de saisie (Lot 3.1)

  @ApiPropertyOptional({
    enum: ['MONTANT', 'ENCOURS_TIE'],
    default: 'MONTANT',
    description:
      'MONTANT (défaut) : `montantDevise` est saisi directement. ' +
      'ENCOURS_TIE : le service recalcule `montantDevise = encoursMoyen × tie / 12` ' +
      "(réservé aux comptes porteurs d'intérêts).",
  })
  @IsOptional()
  @IsIn(['MONTANT', 'ENCOURS_TIE'])
  modeSaisie?: ModeSaisieFaitBudget;

  @ApiPropertyOptional({
    example: 896000000,
    description:
      "Encours moyen mensuel (devise saisie). Requis si modeSaisie='ENCOURS_TIE', interdit sinon.",
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  encoursMoyen?: number;

  @ApiPropertyOptional({
    example: 0.085,
    description:
      "TIE annuel décimal (ex. 0.0850 = 8,50 %). Requis si modeSaisie='ENCOURS_TIE', interdit sinon.",
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(1)
  tie?: number;

  @ApiPropertyOptional({
    example: 'Hypothèse encours retail PCT — comité ALCO mars 2026',
    maxLength: 2000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  commentaire?: string;
}
