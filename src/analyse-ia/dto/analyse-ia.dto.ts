import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';

const MOIS = /^\d{4}-\d{2}$/;

/** Données passées à AnalyseIaService.creer() (persistance best-effort). */
export interface CreerAnalyseIaData {
  fkUser: string;
  demandeurEmail: string;
  dateGeneration: Date;
  versionId: string;
  scenarioId: string;
  moisDebut: string;
  moisFin: string;
  crsSelectionnes: string[] | null;
  modele: string;
  promptVersion: string;
  reponseMarkdown: string;
  kpiSnapshot: Record<string, unknown> | null;
  tokensIn: number;
  tokensOut: number;
  dureeMs: number;
  coutEstime: number;
  dryRun: boolean;
}

// ─── Requête de liste ────────────────────────────────────────────────

export class ListerAnalysesIaQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  versionId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  scenarioId?: string;

  @ApiPropertyOptional({ example: '2027-01' })
  @IsOptional()
  @Matches(MOIS, { message: 'moisDebut doit être au format YYYY-MM.' })
  moisDebut?: string;

  @ApiPropertyOptional({ example: '2027-03' })
  @IsOptional()
  @Matches(MOIS, { message: 'moisFin doit être au format YYYY-MM.' })
  moisFin?: string;
}

// ─── Réponses ────────────────────────────────────────────────────────

/** Élément de liste — SANS le markdown complet (résumé seulement). */
export class AnalyseIaListItemDto {
  @ApiProperty() id!: string;
  @ApiProperty() dateGeneration!: string;
  @ApiProperty() demandeurEmail!: string;
  @ApiProperty() versionId!: string;
  @ApiProperty() scenarioId!: string;
  @ApiProperty() moisDebut!: string;
  @ApiProperty() moisFin!: string;
  @ApiProperty() modele!: string;
  @ApiProperty() tokensIn!: number;
  @ApiProperty() tokensOut!: number;
  @ApiProperty() dureeMs!: number;
  @ApiProperty() coutEstime!: number;
  @ApiProperty() dryRun!: boolean;
  /** Extrait du markdown (premières lignes). */
  @ApiProperty() resume!: string;
}

/** Détail complet — avec markdown + kpi_snapshot. */
export class AnalyseIaDetailDto extends AnalyseIaListItemDto {
  @ApiPropertyOptional({ type: [String] })
  crsSelectionnes!: string[] | null;
  @ApiProperty() promptVersion!: string;
  @ApiProperty() reponseMarkdown!: string;
  @ApiPropertyOptional() kpiSnapshot!: Record<string, unknown> | null;
}

export class PaginatedAnalysesIaDto {
  @ApiProperty({ type: [AnalyseIaListItemDto] })
  items!: AnalyseIaListItemDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
}
