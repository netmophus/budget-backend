import { ApiProperty } from '@nestjs/swagger';

import type { StatutCrSaisie } from '../entities/fait-budget-cr-statut.entity';

/**
 * Statut d'un CR pour une version + traces (qui/quand) — réponse des
 * transitions et de GET /budget/cr/:crCode/statut.
 */
export class CrStatutResponseDto {
  @ApiProperty() versionId!: string;
  @ApiProperty() crId!: string;
  @ApiProperty() crCode!: string;
  @ApiProperty({ example: 'SOUMIS' }) statut!: StatutCrSaisie;
  @ApiProperty({ nullable: true }) dateSoumission!: Date | null;
  @ApiProperty({ nullable: true }) dateValidation!: Date | null;
  @ApiProperty({ nullable: true }) dateReouverture!: Date | null;
  @ApiProperty({ nullable: true }) fkSaisisseur!: string | null;
  @ApiProperty({ nullable: true }) fkValidateur!: string | null;
  @ApiProperty({ nullable: true }) motifRejet!: string | null;
  @ApiProperty({ nullable: true }) motifReouverture!: string | null;
}

/** Ligne CR dans la vue d'ensemble d'une version. */
export class CrStatutLigneDto {
  @ApiProperty() crId!: string;
  @ApiProperty() crCode!: string;
  @ApiProperty() libelle!: string;
  @ApiProperty({ example: 'EN_SAISIE' }) statut!: StatutCrSaisie;
  @ApiProperty({ nullable: true }) saisisseurEmail!: string | null;
  @ApiProperty({ nullable: true }) validateurEmail!: string | null;
  @ApiProperty({ nullable: true }) dateSoumission!: Date | null;
  @ApiProperty({ nullable: true }) dateValidation!: Date | null;
  @ApiProperty({ description: 'PNB du CR (Produits cl.7 − Charges cl.6).' })
  pnb!: number;
}

/**
 * Vue d'ensemble des CR attendus d'une version (snapshot) + compteur
 * « X/Y validés » et statut de la version.
 */
export class StatutsCrsResponseDto {
  @ApiProperty() versionId!: string;
  @ApiProperty({ example: 'ouvert' }) statutVersion!: string;
  @ApiProperty({ example: 11, description: 'CR attendus (snapshot actif).' })
  totalAttendus!: number;
  @ApiProperty({ example: 8 }) nbValides!: number;
  @ApiProperty({ example: 2 }) nbSoumis!: number;
  @ApiProperty({ example: 1 }) nbEnSaisie!: number;
  @ApiProperty({ type: [CrStatutLigneDto] }) crs!: CrStatutLigneDto[];
}
