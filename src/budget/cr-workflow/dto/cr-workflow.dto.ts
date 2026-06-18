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
