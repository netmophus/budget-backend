import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

import type {
  CiblePerimetreType,
  OriginePerimetre,
} from '../entities/user-perimetre.entity';

const CIBLE_TYPES: CiblePerimetreType[] = ['STRUCTURE', 'CR', 'CR_SET'];
const ORIGINES: OriginePerimetre[] = ['PRINCIPAL', 'AFFECTATION', 'DELEGATION'];

export class CreerAffectationPerimetreDto {
  @ApiProperty({ enum: CIBLE_TYPES })
  @IsEnum(CIBLE_TYPES)
  cibleType!: CiblePerimetreType;

  @ApiPropertyOptional({
    description: 'Id de la cible (STRUCTURE ou CR). Interdit pour CR_SET.',
  })
  @IsOptional()
  @IsString()
  cibleId?: string;

  @ApiPropertyOptional({
    description: "Liste des id CR (≥ 2). Réservé à cible_type='CR_SET'.",
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(2)
  @IsString({ each: true })
  cibleCrIds?: string[];

  @ApiPropertyOptional({ enum: ORIGINES, default: 'AFFECTATION' })
  @IsOptional()
  @IsEnum(ORIGINES)
  origine?: OriginePerimetre;

  @ApiPropertyOptional({ description: 'Format YYYY-MM-DD.' })
  @IsOptional()
  @IsDateString()
  dateDebut?: string;

  @ApiPropertyOptional({ description: 'Format YYYY-MM-DD.' })
  @IsOptional()
  @IsDateString()
  dateFin?: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  motif?: string;
}

export class ListerPerimetresUserQueryDto {
  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  actif?: boolean;

  @ApiPropertyOptional({ enum: ORIGINES })
  @IsOptional()
  @IsEnum(ORIGINES)
  origine?: OriginePerimetre;

  @ApiPropertyOptional({ description: 'Filtre dates effet (YYYY-MM-DD).' })
  @IsOptional()
  @IsDateString()
  dateRef?: string;
}

export class AffectationPerimetreResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: CIBLE_TYPES })
  cibleType!: CiblePerimetreType;

  @ApiPropertyOptional({ nullable: true })
  cibleId!: string | null;

  @ApiPropertyOptional({ nullable: true, type: [String] })
  cibleCrIds!: string[] | null;

  @ApiProperty({ enum: ORIGINES })
  origine!: OriginePerimetre;

  @ApiPropertyOptional({ nullable: true })
  delegationId!: string | null;

  @ApiProperty()
  dateDebut!: string;

  @ApiPropertyOptional({ nullable: true })
  dateFin!: string | null;

  @ApiProperty()
  actif!: boolean;

  @ApiPropertyOptional({ nullable: true })
  motif!: string | null;
}
