import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import type { ModeSaisieFaitBudget } from '../../faits/budget/entities/fait-budget.entity';
import type { SensCompte } from '../../referentiels/compte/entities/dim-compte.entity';

// ─── DTO de réponse GET /fait-budget/par-grille ────────────────────

export class CompteEligibleDto {
  @ApiProperty({ example: '42' })
  id!: string;

  @ApiProperty({ example: '611100' })
  codeCompte!: string;

  @ApiProperty({ example: 'Salaires bruts' })
  libelle!: string;

  @ApiProperty({ example: '6' })
  classe!: string;

  @ApiPropertyOptional({ example: 'D', nullable: true })
  sens!: SensCompte | null;

  @ApiProperty({ example: false })
  estPorteurInterets!: boolean;
}

export class LigneMetierResumeDto {
  @ApiProperty({ example: '5' })
  id!: string;

  @ApiProperty({ example: 'RETAIL' })
  codeLigneMetier!: string;

  @ApiProperty({ example: 'Banque de détail' })
  libelle!: string;
}

export class CelluleGrilleDto {
  @ApiProperty({ example: '2027-04-01', format: 'date' })
  mois!: string;

  @ApiProperty({ example: 10200000 })
  montant!: number;

  @ApiPropertyOptional({ enum: ['MONTANT', 'ENCOURS_TIE'], nullable: true })
  modeSaisie!: ModeSaisieFaitBudget | null;

  @ApiPropertyOptional({ example: 896000000, nullable: true })
  encoursMoyen!: number | null;

  @ApiPropertyOptional({ example: 0.085, nullable: true })
  tie!: number | null;

  @ApiPropertyOptional({ nullable: true })
  commentaire!: string | null;

  @ApiPropertyOptional({ example: '1234', nullable: true })
  ligneId!: string | null;
}

export class LigneGrilleDto {
  @ApiProperty({ type: CompteEligibleDto })
  compte!: CompteEligibleDto;

  @ApiProperty({ type: LigneMetierResumeDto })
  ligneMetier!: LigneMetierResumeDto;

  @ApiProperty({ type: [CelluleGrilleDto] })
  cellules!: CelluleGrilleDto[];

  @ApiProperty({ example: 140800000 })
  totalAnnee!: number;
}

export class GrilleVersionRefDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  codeVersion!: string;

  @ApiProperty()
  libelle!: string;

  @ApiProperty()
  statut!: string;
}

export class GrilleScenarioRefDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  codeScenario!: string;

  @ApiProperty()
  libelle!: string;

  @ApiProperty()
  typeScenario!: string;
}

export class GrilleStructureRefDto {
  @ApiProperty()
  codeStructure!: string;

  @ApiProperty()
  libelle!: string;
}

export class GrilleCrRefDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  codeCr!: string;

  @ApiProperty()
  libelle!: string;

  @ApiPropertyOptional({ type: GrilleStructureRefDto, nullable: true })
  structureRattachee!: GrilleStructureRefDto | null;
}

export class TotalMensuelDto {
  @ApiProperty({ example: '2027-04-01', format: 'date' })
  mois!: string;

  @ApiProperty({ example: -50000000 })
  total!: number;
}

export class GrilleSaisieReponseDto {
  @ApiProperty({ type: GrilleVersionRefDto })
  version!: GrilleVersionRefDto;

  @ApiProperty({ type: GrilleScenarioRefDto })
  scenario!: GrilleScenarioRefDto;

  @ApiProperty({ type: GrilleCrRefDto })
  cr!: GrilleCrRefDto;

  @ApiProperty({ example: 2027 })
  exerciceFiscal!: number;

  @ApiProperty({ type: [String], example: ['Janvier 2027', 'Février 2027'] })
  moisLabels!: string[];

  @ApiProperty({ type: [CompteEligibleDto] })
  comptesFeuillesEligibles!: CompteEligibleDto[];

  @ApiProperty({ type: [LigneGrilleDto] })
  lignes!: LigneGrilleDto[];

  @ApiProperty({ type: [TotalMensuelDto] })
  totauxMensuels!: TotalMensuelDto[];

  @ApiProperty({ example: -200000000 })
  totalAnneeCr!: number;
}

// ─── DTO query GET /fait-budget/par-grille ─────────────────────────

export class GetGrilleSaisieQueryDto {
  @ApiProperty({ example: '2' })
  @IsString()
  @Matches(/^\d+$/)
  versionId!: string;

  @ApiProperty({ example: '1' })
  @IsString()
  @Matches(/^\d+$/)
  scenarioId!: string;

  @ApiProperty({ example: '12' })
  @IsString()
  @Matches(/^\d+$/)
  crId!: string;

  @ApiProperty({ example: 2027, minimum: 2020, maximum: 2050 })
  @Type(() => Number)
  @IsInt()
  @Min(2020)
  @Max(2050)
  exerciceFiscal!: number;

  /**
   * Lot 3.4-bis : obligatoire. La grille est désormais construite
   * sur (CR × ligne_metier × classe), permettant la saisie
   * from-scratch sans ligne fait_budget pré-existante.
   */
  @ApiProperty({ example: '5' })
  @IsString()
  @Matches(/^\d+$/, {
    message: 'ligneMetierId obligatoire (Lot 3.4-bis)',
  })
  ligneMetierId!: string;

  @ApiPropertyOptional({ example: '6' })
  @IsOptional()
  @IsString()
  @MaxLength(2)
  classeCompte?: string;
}

// ─── DTO POST /fait-budget/grille (saisie en lot) ──────────────────

export class CelluleGrilleEntreeDto {
  @ApiProperty({ example: '2027-04-01' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-01$/, {
    message: 'mois doit être un 1er du mois au format YYYY-MM-01',
  })
  mois!: string;

  @ApiProperty({ example: 10200000 })
  @IsNumber({ maxDecimalPlaces: 4 })
  montant!: number;

  @ApiPropertyOptional({ enum: ['MONTANT', 'ENCOURS_TIE'] })
  @IsOptional()
  @IsIn(['MONTANT', 'ENCOURS_TIE'])
  modeSaisie?: ModeSaisieFaitBudget;

  @ApiPropertyOptional({ example: 896000000 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  encoursMoyen?: number;

  @ApiPropertyOptional({ example: 0.085 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(1)
  tie?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  commentaire?: string;
}

export class LigneGrilleEntreeDto {
  @ApiProperty({ example: '42' })
  @IsString()
  @Matches(/^\d+$/)
  compteId!: string;

  @ApiProperty({ example: '5' })
  @IsString()
  @Matches(/^\d+$/)
  ligneMetierId!: string;

  @ApiProperty({ type: [CelluleGrilleEntreeDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CelluleGrilleEntreeDto)
  cellules!: CelluleGrilleEntreeDto[];
}

export class PostGrilleSaisieDto {
  @ApiProperty({ example: '2' })
  @IsString()
  @Matches(/^\d+$/)
  versionId!: string;

  @ApiProperty({ example: '1' })
  @IsString()
  @Matches(/^\d+$/)
  scenarioId!: string;

  @ApiProperty({ example: '12' })
  @IsString()
  @Matches(/^\d+$/)
  crId!: string;

  @ApiProperty({ type: [LigneGrilleEntreeDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LigneGrilleEntreeDto)
  lignes!: LigneGrilleEntreeDto[];
}

export class ErreurCelluleDto {
  @ApiProperty({ example: 0 })
  ligneIndex!: number;

  @ApiProperty({ example: '2027-04-01' })
  mois!: string;

  @ApiProperty()
  message!: string;

  @ApiProperty({ example: 'COMPTE_AGREGE' })
  code!: string;
}

export class PostGrilleSaisieReponseDto {
  @ApiProperty({ example: 360 })
  totalCellules!: number;

  @ApiProperty({ example: 280 })
  inserees!: number;

  @ApiProperty({ example: 50 })
  modifiees!: number;

  @ApiProperty({ example: 25 })
  supprimees!: number;

  @ApiProperty({ example: 5 })
  ignorees!: number;

  @ApiProperty({ type: [ErreurCelluleDto] })
  erreurs!: ErreurCelluleDto[];

  @ApiProperty({ example: 1200 })
  dureeMs!: number;
}
