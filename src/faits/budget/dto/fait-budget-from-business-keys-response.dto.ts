import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { FaitBudgetResponseDto } from './fait-budget-response.dto';

/**
 * Source du `tauxChangeApplique` retenu :
 *  - `'fourni-utilisateur'` : valeur passée explicitement dans le DTO,
 *    aucune résolution automatique appelée.
 *  - `'auto-pivot-xof'` : devise = pivot XOF → 1.0 sans appel taux.
 *  - `'auto-fixe-budgetaire'` / `'auto-cloture'` /
 *    `'auto-moyen-mensuel'` : résolu via
 *    `TauxChangeService.findTauxApplicable` avec ce typeTaux.
 */
export type TauxChangeSource =
  | 'fourni-utilisateur'
  | 'auto-pivot-xof'
  | 'auto-fixe-budgetaire'
  | 'auto-cloture'
  | 'auto-moyen-mensuel';

export type MontantFcfaSource = 'fourni-utilisateur' | 'calcule-automatique';

export class DimensionResolueDto {
  @ApiProperty({ example: 'compte' })
  axe!: string;

  @ApiProperty({ example: '611100' })
  codeBusiness!: string;

  @ApiProperty({ example: '42' })
  fkResolu!: string;

  @ApiProperty({ example: '2026-01-01', format: 'date' })
  dateDebutValidite!: string;

  @ApiPropertyOptional({
    example: '2026-04-01',
    format: 'date',
    nullable: true,
  })
  dateFinValidite!: string | null;
}

/**
 * Détails de résolution exposés UNIQUEMENT en réponse de
 * `POST /from-business-keys` — pour audit + debug + UI Lot 3.5.
 *
 * Non persisté dans `fait_budget` : la table ne le supporte pas.
 * L'audit_log capte transversalement le payload de la requête + le
 * retour, donc ces détails sont tracés (cf. AuditInterceptor).
 */
export class ResolutionDetailsDto {
  @ApiProperty({
    enum: [
      'fourni-utilisateur',
      'auto-pivot-xof',
      'auto-fixe-budgetaire',
      'auto-cloture',
      'auto-moyen-mensuel',
    ],
    example: 'auto-fixe-budgetaire',
  })
  tauxChangeSource!: TauxChangeSource;

  @ApiPropertyOptional({
    example: '2026-03-31',
    format: 'date',
    nullable: true,
    description:
      "Date du taux retenu (côté ref_taux_change). Null pour XOF pivot ou pour un taux fourni manuellement (pas de date applicable issue d'un référentiel).",
  })
  dateApplicableTaux!: string | null;

  @ApiProperty({
    enum: ['fourni-utilisateur', 'calcule-automatique'],
    example: 'calcule-automatique',
  })
  montantFcfaSource!: MontantFcfaSource;

  @ApiProperty({ type: [DimensionResolueDto] })
  dimensionsResolues!: DimensionResolueDto[];
}

export class FaitBudgetFromBusinessKeysResponseDto extends FaitBudgetResponseDto {
  @ApiProperty({ type: ResolutionDetailsDto })
  resolutionDetails!: ResolutionDetailsDto;
}
