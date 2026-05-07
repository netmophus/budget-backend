import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
} from 'class-validator';

import type { StatutEmail, TypeEvenement } from '../entities/email-log.entity';

const TYPES_EVENEMENT: TypeEvenement[] = [
  'BUDGET_SOUMIS',
  'BUDGET_VALIDE',
  'BUDGET_REJETE',
  'BUDGET_PUBLIE',
  'DELEGATION_CREEE',
  'DELEGATION_EXPIREE',
  'DELEGATION_REVOQUEE',
  'AFFECTATION_CREEE',
];

const STATUTS: StatutEmail[] = ['EN_ATTENTE', 'ENVOYE', 'ECHEC', 'SUPPRIME'];

export class ListerEmailLogQueryDto {
  @ApiPropertyOptional({ enum: STATUTS, isArray: true })
  @IsOptional()
  @IsArray()
  @IsIn(STATUTS, { each: true })
  statuts?: StatutEmail[];

  @ApiPropertyOptional({ enum: TYPES_EVENEMENT, isArray: true })
  @IsOptional()
  @IsArray()
  @IsIn(TYPES_EVENEMENT, { each: true })
  evenements?: TypeEvenement[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dateDebut?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dateFin?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  rechercheEmail?: string;

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

export class EmailLogResponseDto {
  @ApiProperty()
  id!: string;
  @ApiProperty()
  evenement!: TypeEvenement;
  @ApiPropertyOptional({ nullable: true })
  fkDestinataire!: string | null;
  @ApiProperty()
  destinataireEmail!: string;
  @ApiProperty()
  sujet!: string;
  @ApiProperty()
  template!: string;
  @ApiProperty()
  payload!: Record<string, unknown>;
  @ApiProperty({ enum: STATUTS })
  statut!: StatutEmail;
  @ApiProperty()
  tentatives!: number;
  @ApiPropertyOptional({ nullable: true })
  dernierMessageErreur!: string | null;
  @ApiPropertyOptional({ nullable: true })
  envoyeLe!: string | null;
  @ApiProperty()
  dateCreation!: string;
}

export class StatistiquesEmailDto {
  @ApiProperty()
  total7Jours!: number;
  @ApiProperty()
  total30Jours!: number;
  @ApiProperty({ description: 'Nombre par statut sur 30 jours' })
  parStatut!: Record<StatutEmail, number>;
  @ApiProperty({ description: 'Nombre par évenement sur 30 jours' })
  parEvenement!: Record<string, number>;
}

export class PreferencesNotificationsDto {
  @ApiProperty()
  @IsBoolean()
  notificationsEmailActives!: boolean;

  @ApiPropertyOptional({
    type: [String],
    description: 'Types acceptés (NULL = tous).',
    nullable: true,
  })
  @IsOptional()
  @IsArray()
  @IsIn(TYPES_EVENEMENT, { each: true })
  notificationsEmailTypes!: TypeEvenement[] | null;
}
