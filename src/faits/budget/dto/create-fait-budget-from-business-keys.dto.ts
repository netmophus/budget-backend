import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import type { TypeTaux } from '../../../referentiels/taux-change/entities/ref-taux-change.entity';
import type { ModeSaisieFaitBudget } from '../entities/fait-budget.entity';

/**
 * DTO de création d'un `fait_budget` depuis les codes business.
 *
 * Point d'entrée principal pour la saisie utilisateur (Lot 3.5).
 * Implémente Option B (`docs/modele-donnees.md` §6.3) : les FK SCD2
 * sont résolues vers la version VALIDE À LA DATE MÉTIER. Le taux de
 * change et le montant FCFA sont calculés automatiquement quand
 * `tauxChangeApplique` et/ou `montantFcfa` ne sont pas fournis.
 */
export class CreateFaitBudgetFromBusinessKeysDto {
  // ─── Date métier (résout fk_temps + sert de référence pour SCD2)

  @ApiProperty({
    example: '2026-04-01',
    description:
      'Date métier du fait, format YYYY-MM-DD. Doit être un 1er du mois (maille mensuelle, cf. modele-donnees §4.1). Sert à résoudre fk_temps ET les versions SCD2 (Option B).',
  })
  @IsDateString(
    { strict: true },
    {
      message: 'dateMetier doit être une date ISO YYYY-MM-DD',
    },
  )
  @Matches(/^\d{4}-\d{2}-01$/, {
    message:
      'dateMetier doit être un 1er du mois (maille mensuelle) — ex. 2026-04-01',
  })
  dateMetier!: string;

  // ─── Codes business — 6 dimensions SCD2 (Option B)

  @ApiProperty({ example: 'AG_ABJ_COCODY' })
  @IsString()
  @MaxLength(50)
  codeStructure!: string;

  @ApiProperty({ example: 'CR_RETAIL_ABJ' })
  @IsString()
  @MaxLength(50)
  codeCentre!: string;

  @ApiProperty({ example: '611100' })
  @IsString()
  @MaxLength(20)
  codeCompte!: string;

  @ApiProperty({ example: 'RETAIL' })
  @IsString()
  @MaxLength(50)
  codeLigneMetier!: string;

  @ApiProperty({ example: 'DEPOT_VUE' })
  @IsString()
  @MaxLength(50)
  codeProduit!: string;

  @ApiProperty({ example: 'PARTICULIER' })
  @IsString()
  @MaxLength(50)
  codeSegment!: string;

  // ─── Codes business — 3 dimensions non-SCD2

  @ApiProperty({
    example: 'EUR',
    description: 'Code ISO 4217 de la devise (3 lettres majuscules).',
  })
  @IsString()
  @Matches(/^[A-Z]{3}$/, {
    message: 'codeDevise doit être un code ISO 4217 (3 lettres majuscules)',
  })
  codeDevise!: string;

  @ApiProperty({ example: 'BUDGET_INITIAL_2026' })
  @IsString()
  @MaxLength(50)
  codeVersion!: string;

  @ApiProperty({ example: 'CENTRAL' })
  @IsString()
  @MaxLength(50)
  codeScenario!: string;

  // ─── Mesures

  @ApiProperty({ example: 1000, description: "Montant en devise d'origine." })
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  montantDevise!: number;

  @ApiPropertyOptional({
    example: 655.957,
    description:
      'Taux appliqué (1 unité de devise = X FCFA). Si absent : résolu via TauxChangeService.findTauxApplicable. Si codeDevise=XOF, doit valoir 1.0 (validé applicativement).',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 8 })
  @Min(0.00000001)
  tauxChangeApplique?: number;

  @ApiPropertyOptional({
    example: 655957,
    description:
      'Montant en FCFA. Si absent : calculé = montantDevise × tauxChangeApplique. Si fourni, doit être cohérent (tolérance 0.01).',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  montantFcfa?: number;

  @ApiPropertyOptional({
    enum: ['cloture', 'moyen_mensuel', 'fixe_budgetaire'],
    description:
      "Type de taux à utiliser pour la résolution auto. Par défaut : 'fixe_budgetaire' pour les versions budget_initial / atterrissage, 'cloture' pour les reforecast.",
  })
  @IsOptional()
  @IsIn(['cloture', 'moyen_mensuel', 'fixe_budgetaire'])
  typeTaux?: TypeTaux;

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
    description: "Encours moyen mensuel. Requis si modeSaisie='ENCOURS_TIE'.",
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  encoursMoyen?: number;

  @ApiPropertyOptional({
    example: 0.085,
    description:
      "TIE annuel décimal. Requis si modeSaisie='ENCOURS_TIE'. Range [0,1].",
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
