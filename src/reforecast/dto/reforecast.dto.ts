import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import type {
  MethodeExtrapolation,
  StatutPublicationVersion,
  StatutVersion,
} from '../../referentiels/version/entities/dim-version.entity';

const METHODES: MethodeExtrapolation[] = [
  'MOYENNE_TRIMESTRE',
  'BUDGET_INITIAL',
  'MANUELLE',
];

export class LancerReforecastDto {
  @ApiProperty({ description: "Version d'origine (statut=gele)." })
  @IsString()
  @IsNotEmpty()
  fkVersionSource!: string;

  @ApiProperty({ description: "Scénario d'origine." })
  @IsString()
  @IsNotEmpty()
  fkScenarioSource!: string;

  @ApiProperty({ minimum: 1, maximum: 4 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(4)
  trimestreConsolide!: number;

  @ApiProperty({ example: 2027 })
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  anneeConsolide!: number;

  @ApiProperty({ enum: METHODES })
  @IsIn(METHODES)
  methodeExtrapolation!: MethodeExtrapolation;

  @ApiProperty({
    description: 'Libellé de la nouvelle version REFORECAST.',
    example: 'Reforecast T1 2027',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  libelleNouveauVersion!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  commentaire?: string;
}

export class ListerReforecastsDto {
  @ApiPropertyOptional({ enum: ['ACTIVE', 'OBSOLETE'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'OBSOLETE'])
  statutPublication?: StatutPublicationVersion;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  fkVersionSource?: string;

  @ApiPropertyOptional({ example: 2027 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  anneeConsolide?: number;

  @ApiPropertyOptional({ enum: ['ouvert', 'soumis', 'valide', 'gele'] })
  @IsOptional()
  @IsIn(['ouvert', 'soumis', 'valide', 'gele'])
  statutWorkflow?: StatutVersion;
}

/**
 * Filtres alternatifs URL-friendly (BROUILLON / SOUMIS / VALIDE /
 * PUBLIE) qui mappent vers les statuts SQL bas niveau ouvert /
 * soumis / valide / gele.
 */
const URL_TO_DB: Record<string, StatutVersion> = {
  BROUILLON: 'ouvert',
  SOUMIS: 'soumis',
  VALIDE: 'valide',
  PUBLIE: 'gele',
};

export function mapStatutWorkflowParam(
  v: string | undefined,
): StatutVersion | undefined {
  if (!v) return undefined;
  return URL_TO_DB[v.toUpperCase()] ?? (v as StatutVersion);
}

export class ReforecastResponseDto {
  @ApiProperty()
  id!: string;
  @ApiProperty()
  codeVersion!: string;
  @ApiProperty()
  libelle!: string;
  @ApiProperty()
  exerciceFiscal!: number;
  @ApiProperty({ enum: ['ouvert', 'soumis', 'valide', 'gele'] })
  statut!: StatutVersion;
  @ApiProperty({ enum: ['ACTIVE', 'OBSOLETE'] })
  statutPublication!: StatutPublicationVersion;

  @ApiProperty()
  fkVersionSource!: string;
  @ApiProperty()
  fkScenarioSource!: string;
  @ApiProperty()
  trimestreConsolide!: number;
  @ApiProperty()
  anneeConsolide!: number;
  @ApiProperty({ enum: METHODES })
  methodeExtrapolation!: MethodeExtrapolation;

  @ApiPropertyOptional({ nullable: true })
  dateObsolescence!: Date | null;
  @ApiPropertyOptional({ nullable: true })
  fkVersionRemplacante!: string | null;

  @ApiPropertyOptional({ nullable: true })
  libelleVersionSource!: string | null;
  @ApiPropertyOptional({ nullable: true })
  libelleScenarioSource!: string | null;

  @ApiProperty()
  dateCreation!: Date;
  @ApiProperty()
  utilisateurCreation!: string;
  @ApiPropertyOptional({ nullable: true })
  commentaire!: string | null;
  @ApiPropertyOptional()
  nbLignes?: number;
}

export class LigneComparaisonDto {
  @ApiProperty()
  fkCentre!: string;
  @ApiProperty()
  codeCr!: string;
  @ApiProperty()
  fkCompte!: string;
  @ApiProperty()
  codeCompte!: string;
  @ApiProperty()
  fkLigneMetier!: string;
  @ApiProperty()
  codeLigneMetier!: string;
  @ApiProperty()
  fkTemps!: string;
  @ApiProperty()
  mois!: number;
  @ApiProperty()
  annee!: number;
  @ApiProperty({ enum: ['REALISE', 'EXTRAPOLATION', 'MANUEL'] })
  origine!: 'REALISE' | 'EXTRAPOLATION' | 'MANUEL';
  @ApiProperty()
  montantSource!: number;
  @ApiProperty()
  montantReforecast!: number;
  @ApiProperty()
  ecart!: number;
}

export class ComparaisonResponseDto {
  @ApiProperty({ type: [LigneComparaisonDto] })
  lignes!: LigneComparaisonDto[];
  @ApiProperty()
  totalSource!: number;
  @ApiProperty()
  totalReforecast!: number;
  @ApiProperty()
  totalEcart!: number;
}

// Workflow DTOs (réutilisent ceux de version, ré-exportés ici pour
// que le controller reste autonome dans son module)

export class SoumettreReforecastDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  commentaire?: string;
}

export class ValiderReforecastDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  commentaire?: string;
}

export class RejeterReforecastDto {
  @ApiProperty({ description: 'Motif du rejet (obligatoire).' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  commentaire!: string;
}

export class PublierReforecastDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  commentaire?: string;
}
