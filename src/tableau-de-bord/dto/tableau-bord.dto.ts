import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';

/**
 * Filtres du tableau de bord budget vs réalisé (Lot 5.2).
 *
 * Les seuils de pourcentage sont paramétrables côté requête —
 * permet à un contrôleur d'ajuster sa lecture (5/10 par défaut,
 * peut passer à 3/7 pour une lecture plus stricte).
 */
export class FiltresEcartsDto {
  @ApiProperty()
  @IsString()
  versionId!: string;

  @ApiProperty()
  @IsString()
  scenarioId!: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Restriction par CR. Vide = tous CR du périmètre user.',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  crIds?: string[];

  @ApiPropertyOptional({
    type: [String],
    description: 'Restriction par lignes métier.',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  ligneMetierIds?: string[];

  @ApiProperty({ example: '2027-01' })
  @Matches(/^\d{4}-\d{2}$/, { message: 'Format YYYY-MM attendu pour moisDebut.' })
  moisDebut!: string;

  @ApiProperty({ example: '2027-12' })
  @Matches(/^\d{4}-\d{2}$/, { message: 'Format YYYY-MM attendu pour moisFin.' })
  moisFin!: string;

  @ApiPropertyOptional({
    default: 5,
    description: 'Seuil pourcentage déclenchant niveau ATTENTION (>=).',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  seuilEcartPctAttention?: number;

  @ApiPropertyOptional({
    default: 10,
    description: 'Seuil pourcentage déclenchant niveau CRITIQUE (>=).',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000)
  seuilEcartPctCritique?: number;
}

export type NiveauAlerte = 'NORMAL' | 'ATTENTION' | 'CRITIQUE' | 'MANQUANT';
export type NatureCompte = 'CHARGE' | 'PRODUIT' | 'BILAN';
export type SensEcart = 'FAVORABLE' | 'DEFAVORABLE' | 'NEUTRE';

export class LigneEcartDto {
  @ApiProperty()
  codeCr!: string;
  @ApiProperty()
  libelleCr!: string;
  @ApiProperty()
  codeCompte!: string;
  @ApiProperty()
  libelleCompte!: string;
  @ApiProperty()
  classeCompte!: string;
  @ApiProperty({ enum: ['CHARGE', 'PRODUIT', 'BILAN'] })
  natureCompte!: NatureCompte;
  @ApiProperty()
  codeLigneMetier!: string;
  @ApiProperty()
  mois!: string; // YYYY-MM
  @ApiProperty()
  libelleMois!: string; // "Mars 2027"
  @ApiProperty()
  montantBudget!: number;
  @ApiPropertyOptional({ nullable: true })
  montantRealise!: number | null;
  @ApiPropertyOptional({ nullable: true })
  ecart!: number | null;
  @ApiPropertyOptional({ nullable: true })
  ecartAbs!: number | null;
  @ApiPropertyOptional({ nullable: true })
  ecartPct!: number | null;
  @ApiProperty({ enum: ['NORMAL', 'ATTENTION', 'CRITIQUE', 'MANQUANT'] })
  niveauAlerte!: NiveauAlerte;
  @ApiPropertyOptional({
    enum: ['FAVORABLE', 'DEFAVORABLE', 'NEUTRE'],
    nullable: true,
  })
  sensEcart!: SensEcart | null;
}

export class KpiEcartsDto {
  @ApiProperty()
  nbEcartsTotal!: number;
  @ApiProperty()
  nbEcartsCritique!: number;
  @ApiProperty()
  nbEcartsAttention!: number;
  @ApiProperty()
  nbLignesManquantes!: number;
  @ApiProperty()
  ecartTotalAbs!: number;
  @ApiProperty()
  ecartTotalDefavorable!: number;
  @ApiProperty()
  ecartTotalFavorable!: number;
}

export class EcartsResponseDto {
  @ApiProperty()
  filtres!: FiltresEcartsDto;
  @ApiProperty({ type: KpiEcartsDto })
  kpi!: KpiEcartsDto;
  @ApiProperty({ type: [LigneEcartDto] })
  lignes!: LigneEcartDto[];
}
