import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import type {
  StatutVersion,
  TypeVersion,
} from '../entities/dim-version.entity';

export class VersionResponseDto {
  @ApiProperty({ example: '42' })
  id!: string;

  @ApiProperty({ example: 'BUDGET_INITIAL_2026' })
  codeVersion!: string;

  @ApiProperty({ example: 'Budget initial 2026' })
  libelle!: string;

  @ApiProperty({
    enum: ['budget_initial', 'reforecast_1', 'reforecast_2', 'atterrissage'],
  })
  typeVersion!: TypeVersion;

  @ApiProperty({ example: 2026 })
  exerciceFiscal!: number;

  @ApiProperty({ enum: ['ouvert', 'soumis', 'valide', 'gele'] })
  statut!: StatutVersion;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  dateGel!: Date | null;

  @ApiPropertyOptional({ example: 'admin@miznas.local', nullable: true })
  utilisateurGel!: string | null;

  @ApiPropertyOptional({ example: 'Cadrage initial DG', nullable: true })
  commentaire!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  dateCreation!: Date;

  @ApiProperty({ example: 'system' })
  utilisateurCreation!: string;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  dateModification!: Date | null;

  @ApiPropertyOptional({ example: 'admin@miznas.local', nullable: true })
  utilisateurModification!: string | null;
}
