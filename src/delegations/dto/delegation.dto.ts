import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

import type { PermissionDelegable } from '../entities/delegation.entity';

const PERMS: PermissionDelegable[] = [
  'SAISIE',
  'SOUMISSION',
  'VALIDATION',
  'PUBLICATION',
];

export class CreerDelegationDto {
  @ApiProperty({ example: '14' })
  @IsString()
  fkDelegataire!: string;

  @ApiProperty({ type: [String], example: ['1', '2'] })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  perimetreUserPerimetreIds!: string[];

  @ApiProperty({ enum: PERMS, isArray: true })
  @IsArray()
  @ArrayMinSize(1)
  @IsIn(PERMS, { each: true })
  permissions!: PermissionDelegable[];

  @ApiProperty({ minLength: 3, maxLength: 2000 })
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  motif!: string;

  @ApiProperty({ example: '2027-01-01' })
  @IsDateString()
  dateDebut!: string;

  @ApiProperty({ example: '2027-04-30' })
  @IsDateString()
  dateFin!: string;
}

export class RevoquerDelegationDto {
  @ApiProperty({ minLength: 3, maxLength: 2000 })
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  motif!: string;
}

export class ListerDelegationsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  actif?: boolean;

  @ApiPropertyOptional({ enum: ['ACTIVE', 'REVOQUEE', 'EXPIREE'] })
  @IsOptional()
  @IsEnum(['ACTIVE', 'REVOQUEE', 'EXPIREE'])
  statut?: 'ACTIVE' | 'REVOQUEE' | 'EXPIREE';

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dateRef?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  delegantId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  delegataireId?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  page?: number;

  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  limit?: number;
}

export class DelegationResponseDto {
  @ApiProperty()
  id!: string;
  @ApiProperty()
  fkDelegant!: string;
  @ApiProperty()
  fkDelegataire!: string;
  @ApiPropertyOptional()
  delegantEmail?: string;
  @ApiPropertyOptional()
  delegataireEmail?: string;
  @ApiProperty({ type: [String] })
  perimetreUserPerimetreIds!: string[];
  @ApiProperty({ enum: PERMS, isArray: true })
  permissions!: PermissionDelegable[];
  @ApiProperty()
  motif!: string;
  @ApiProperty()
  dateDebut!: string;
  @ApiProperty()
  dateFin!: string;
  @ApiProperty()
  actif!: boolean;
  @ApiPropertyOptional({ nullable: true })
  revoqueeLe!: string | null;
  @ApiPropertyOptional({ nullable: true })
  fkRevoquePar!: string | null;
  @ApiPropertyOptional({ nullable: true })
  motifRevocation!: string | null;
  /** Statut calculé : ACTIVE / REVOQUEE / EXPIREE. */
  @ApiProperty({ enum: ['ACTIVE', 'REVOQUEE', 'EXPIREE'] })
  statut!: 'ACTIVE' | 'REVOQUEE' | 'EXPIREE';
}

export class CreerDelegationResponseDto extends DelegationResponseDto {
  @ApiProperty({ type: [String] })
  warnings!: string[];
}
