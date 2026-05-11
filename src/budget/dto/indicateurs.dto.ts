import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';

/**
 * Filtres communs aux endpoints GET /budget/indicateurs/{globaux,par-cr}.
 * `versionId` et `scenarioId` sont OBLIGATOIRES, `exerciceFiscal` aussi
 * (la vue matérialisée groupe par exercice — sans filtre on retourne
 * potentiellement plusieurs années mélangées).
 */
export class IndicateursFiltersDto {
  @ApiProperty({ example: '12', description: 'fk_version' })
  @IsString()
  versionId!: string;

  @ApiProperty({
    example: '7',
    description: 'fk_scenario (Médian, Optimiste, …)',
  })
  @IsString()
  scenarioId!: string;

  @ApiProperty({ example: 2027 })
  @Type(() => Number)
  @IsInt()
  @Min(1900)
  exerciceFiscal!: number;
}

/**
 * Filtres pour la comparaison scénarios (Q17) — pas de scenarioId :
 * on retourne tous les scénarios qui ont des données pour cette
 * version.
 */
export class IndicateursComparaisonFiltersDto {
  @ApiProperty()
  @IsString()
  versionId!: string;

  @ApiProperty({ example: 2027 })
  @Type(() => Number)
  @IsInt()
  @Min(1900)
  exerciceFiscal!: number;
}

// ─── Réponses ────────────────────────────────────────────────────────

export class IndicateursGlobauxDto {
  @ApiProperty({ description: 'Produit Net Bancaire (cl. 7 − 67xxx)' })
  pnb!: number;

  @ApiProperty({ description: "Marge Nette d'Intérêt (76xxx − 67xxx)" })
  mni!: number;

  @ApiPropertyOptional({
    description:
      "Coefficient d'exploitation (charges hors intérêts ÷ PNB × 100). null si PNB ≤ 0.",
    nullable: true,
  })
  coefExploitation!: number | null;

  @ApiProperty({ description: 'Σ classe 6 hors 67xxx' })
  chargesHorsInterets!: number;

  @ApiProperty({ description: 'Σ classe 7 (tous comptes)' })
  totalProduits!: number;

  @ApiProperty({ description: 'Σ classe 6 (tous comptes)' })
  totalCharges!: number;

  @ApiProperty({ description: 'Nombre de CR inclus dans le calcul' })
  nbCrInclus!: number;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Date du dernier enregistrement fait_budget contribuant ' +
      '(MAX(date_modification) figé dans la vue matérialisée).',
  })
  derniereMaj!: string | null;
}

export class IndicateursParCrDto {
  @ApiProperty()
  crId!: string;

  @ApiProperty()
  codeCr!: string;

  @ApiProperty()
  libelleCr!: string;

  @ApiProperty()
  pnb!: number;

  @ApiProperty()
  mni!: number;

  @ApiPropertyOptional({ nullable: true })
  coefExploitation!: number | null;

  @ApiProperty()
  chargesHorsInterets!: number;

  @ApiProperty()
  totalProduits!: number;
}

export class IndicateursComparaisonScenarioDto {
  @ApiProperty()
  scenarioId!: string;

  @ApiProperty()
  codeScenario!: string;

  @ApiProperty()
  libelle!: string;

  @ApiProperty({ example: 'central | optimiste | pessimiste | alternatif' })
  typeScenario!: string;

  @ApiProperty()
  pnb!: number;

  @ApiProperty()
  mni!: number;

  @ApiPropertyOptional({ nullable: true })
  coefExploitation!: number | null;

  @ApiProperty()
  chargesHorsInterets!: number;

  @ApiProperty()
  totalProduits!: number;

  @ApiProperty()
  totalCharges!: number;
}

export class IndicateursComparaisonVersionDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  codeVersion!: string;

  @ApiProperty()
  libelle!: string;
}

export class IndicateursComparaisonDto {
  @ApiProperty({ type: () => IndicateursComparaisonVersionDto })
  version!: IndicateursComparaisonVersionDto;

  @ApiProperty()
  exerciceFiscal!: number;

  @ApiProperty({ type: () => [IndicateursComparaisonScenarioDto] })
  scenarios!: IndicateursComparaisonScenarioDto[];

  @ApiPropertyOptional({ nullable: true })
  derniereMaj!: string | null;
}

export class RefreshIndicateursResponseDto {
  @ApiProperty({ description: 'Durée du REFRESH MATERIALIZED VIEW en ms' })
  dureeMs!: number;

  @ApiProperty({ description: 'Nombre de lignes dans la vue après refresh' })
  nbLignes!: number;
}
