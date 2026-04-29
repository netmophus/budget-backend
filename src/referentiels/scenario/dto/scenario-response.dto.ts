import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import type {
  StatutScenario,
  TypeScenario,
} from '../entities/dim-scenario.entity';

export class ScenarioResponseDto {
  @ApiProperty({ example: '42' })
  id!: string;

  @ApiProperty({ example: 'CENTRAL' })
  codeScenario!: string;

  @ApiProperty({ example: 'Scénario central' })
  libelle!: string;

  @ApiProperty({
    enum: ['central', 'optimiste', 'pessimiste', 'alternatif'],
  })
  typeScenario!: TypeScenario;

  @ApiProperty({ enum: ['actif', 'archive'] })
  statut!: StatutScenario;

  @ApiPropertyOptional({ example: 'Hypothèses macro de référence', nullable: true })
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
