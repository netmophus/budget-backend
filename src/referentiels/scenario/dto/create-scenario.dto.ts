import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

import type { TypeScenario } from '../entities/dim-scenario.entity';

const TYPE_SCENARIO_VALUES: readonly TypeScenario[] = [
  'central',
  'optimiste',
  'pessimiste',
  'alternatif',
];

/**
 * Pas de `statut` dans le DTO : tout nouveau scénario est créé avec
 * `statut = 'actif'`. Transition vers 'archive' via POST /:id/archiver.
 */
export class CreateScenarioDto {
  @ApiProperty({
    example: 'CENTRAL',
    description: 'Business key — alphanumérique + underscore.',
  })
  @IsString()
  @MaxLength(50)
  @Matches(/^[A-Z0-9_]+$/, {
    message:
      'codeScenario doit contenir uniquement majuscules, chiffres et underscores',
  })
  codeScenario!: string;

  @ApiProperty({ example: 'Scénario central', maxLength: 200 })
  @IsString()
  @MaxLength(200)
  libelle!: string;

  @ApiProperty({ enum: TYPE_SCENARIO_VALUES, example: 'central' })
  @IsIn(TYPE_SCENARIO_VALUES as readonly string[])
  typeScenario!: TypeScenario;

  @ApiPropertyOptional({ example: 'Hypothèses macro de référence' })
  @IsOptional()
  @IsString()
  commentaire?: string;
}
