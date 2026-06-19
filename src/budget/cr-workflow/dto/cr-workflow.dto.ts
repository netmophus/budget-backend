import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

/**
 * DTOs du workflow de validation par CR (Lot workflow CR).
 *
 * NB : un statut de CR est porté par le couple (version × CR). Le
 * `versionId` est donc requis sur chaque appel — passé en QUERY param
 * (`?versionId=`) pour garder le body limité au commentaire/motif,
 * conformément à l'esprit du brief.
 */

export class CrContexteQueryDto {
  @ApiProperty({
    example: '5',
    description: 'Id de la version budgétaire (contexte du statut CR).',
  })
  @IsString()
  @Matches(/^\d+$/, {
    message: 'versionId requis (id numérique de la version).',
  })
  versionId!: string;
}

export class SoumettreCrDto {
  @ApiPropertyOptional({
    example: 'Saisie Agence Siège terminée, PNB aligné cible D2.',
    maxLength: 2000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  commentaire?: string;
}

export class ValiderCrDto {
  @ApiPropertyOptional({
    example: 'Validé — cohérent avec le cadrage.',
    maxLength: 2000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  commentaire?: string;
}

export class RejeterCrDto {
  @ApiProperty({
    example: 'Charges support sous-évaluées — revoir la ligne 6132.',
    description:
      'Motif de rejet (obligatoire) communiqué au saisisseur pour correction.',
    maxLength: 2000,
  })
  @IsString()
  @IsNotEmpty({ message: 'Le motif de rejet est obligatoire.' })
  @MaxLength(2000)
  motif!: string;
}

export class RouvrirCrDto {
  @ApiProperty({
    example: 'Réouverture pour intégrer l’arbitrage DG du 18/06.',
    description:
      'Motif de réouverture (obligatoire). Seul le validateur ayant validé peut rouvrir.',
    maxLength: 2000,
  })
  @IsString()
  @IsNotEmpty({ message: 'Le motif de réouverture est obligatoire.' })
  @MaxLength(2000)
  motif!: string;
}

export class RetirerCrSnapshotDto {
  @ApiProperty({
    example: 'CR sans activité budgétaire cette année (décision Comité).',
    description: 'Motif du retrait du CR du snapshot (obligatoire, tracé).',
    maxLength: 2000,
  })
  @IsString()
  @IsNotEmpty({ message: 'Le motif de retrait est obligatoire.' })
  @MaxLength(2000)
  motif!: string;
}

export class SoumettreComiteDto {
  @ApiPropertyOptional({
    example: 'Tous les CR validés — transmission au Comité budgétaire.',
    maxLength: 2000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  commentaire?: string;
}

export class ApprouverComiteDto {
  @ApiPropertyOptional({
    example: 'Budget approuvé par le Comité — séance du 19/06/2026.',
    maxLength: 2000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  commentaire?: string;
}

export class DemanderRevisionComiteDto {
  @ApiProperty({
    example: 'CR_AG_SIEGE',
    description: 'Code du CR validé que le Comité renvoie en révision.',
  })
  @IsString()
  @IsNotEmpty({ message: 'Le code du CR à réviser est obligatoire.' })
  crCode!: string;

  @ApiProperty({
    example: 'Revoir l’hypothèse PNB cl.7 à la baisse (cadrage Holding).',
    description:
      'Motif de la demande de révision (obligatoire), communiqué au ' +
      'saisisseur et au validateur du CR ciblé.',
    maxLength: 2000,
  })
  @IsString()
  @IsNotEmpty({
    message: 'Le motif de la demande de révision est obligatoire.',
  })
  @MaxLength(2000)
  motif!: string;
}
