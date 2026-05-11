import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

import type {
  ModeFaitRealise,
  SourceFaitRealise,
  StatutFaitRealise,
} from '../entities/fait-realise.entity';

const MODES: ModeFaitRealise[] = ['MNT', 'VOL', 'UNIT'];

export class CreerFaitRealiseDto {
  @ApiProperty()
  @IsString()
  fkCentreResponsabilite!: string;

  @ApiProperty()
  @IsString()
  fkCompte!: string;

  @ApiProperty()
  @IsString()
  fkLigneMetier!: string;

  @ApiProperty()
  @IsString()
  fkTemps!: string;

  @ApiProperty()
  @IsString()
  fkDevise!: string;

  @ApiProperty({ example: 1500000 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  montant!: number;

  @ApiPropertyOptional({ enum: MODES, default: 'MNT' })
  @IsOptional()
  @IsIn(MODES)
  mode?: ModeFaitRealise;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 6 })
  tauxChangeApplique?: number;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  commentaire?: string;
}

export class ModifierFaitRealiseDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  montant?: number;

  @ApiPropertyOptional({ enum: MODES })
  @IsOptional()
  @IsIn(MODES)
  mode?: ModeFaitRealise;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 6 })
  tauxChangeApplique?: number;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  commentaire?: string;
}

export class ValiderFaitsRealiseDto {
  @ApiProperty({
    type: [String],
    description: 'Ids des fait_realise à valider.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  ids!: string[];
}

export class ListerFaitsRealiseQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  fkCentreResponsabilite?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  fkCompte?: string;

  @ApiPropertyOptional({ description: 'Mois début YYYY-MM (inclus).' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}$/, { message: 'Format YYYY-MM attendu.' })
  moisDebut?: string;

  @ApiPropertyOptional({ description: 'Mois fin YYYY-MM (inclus).' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}$/, { message: 'Format YYYY-MM attendu.' })
  moisFin?: string;

  @ApiPropertyOptional({ enum: ['IMPORTE', 'VALIDE'] })
  @IsOptional()
  @IsIn(['IMPORTE', 'VALIDE'])
  statut?: StatutFaitRealise;

  @ApiPropertyOptional({ enum: ['IMPORT', 'SAISIE'] })
  @IsOptional()
  @IsIn(['IMPORT', 'SAISIE'])
  source?: SourceFaitRealise;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}

export class FaitRealiseResponseDto {
  @ApiProperty()
  id!: string;
  @ApiProperty()
  fkCentreResponsabilite!: string;
  @ApiProperty()
  fkCompte!: string;
  @ApiProperty()
  fkLigneMetier!: string;
  @ApiProperty()
  fkTemps!: string;
  @ApiProperty()
  fkDevise!: string;
  @ApiProperty()
  montant!: number;
  @ApiProperty()
  tauxChangeApplique!: number;
  @ApiProperty({ enum: MODES })
  mode!: ModeFaitRealise;
  @ApiProperty({ enum: ['IMPORTE', 'VALIDE'] })
  statut!: StatutFaitRealise;
  @ApiProperty({ enum: ['IMPORT', 'SAISIE'] })
  source!: SourceFaitRealise;
  @ApiPropertyOptional({ nullable: true })
  commentaire!: string | null;
  @ApiPropertyOptional({ nullable: true })
  valideLe!: string | null;
  @ApiPropertyOptional({ nullable: true })
  fkValidePar!: string | null;
  @ApiProperty()
  dateCreation!: string;
}

export class RapportImportRealiseDto {
  @ApiProperty()
  nbLignesTraitees!: number;
  @ApiProperty()
  nbLignesCreees!: number;
  @ApiProperty()
  nbLignesMisesAJour!: number;
  @ApiProperty()
  nbLignesIgnorees!: number;
  @ApiProperty()
  nbErreurs!: number;
  @ApiProperty({ type: [Object] })
  erreurs!: Array<{ ligne: number; message: string }>;
  @ApiProperty({ type: [Object] })
  lignesIgnorees!: Array<{ ligne: number; raison: string }>;
}
