import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsIn,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import type { TypeScenario } from '../entities/dim-scenario.entity';

const TYPE_SCENARIO_VALUES: readonly TypeScenario[] = [
  'central',
  'optimiste',
  'pessimiste',
  'alternatif',
];

/**
 * `codeScenario` immuable. `statut` non exposé (transition via
 * POST /:id/archiver). Modification autorisée UNIQUEMENT tant que
 * `statut = 'actif'` — vérifié côté service (409 sinon).
 */
export class UpdateScenarioDto {
  @ApiPropertyOptional({ example: 'Scénario central (V2)' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  libelle?: string;

  @ApiPropertyOptional({ enum: TYPE_SCENARIO_VALUES })
  @IsOptional()
  @IsIn(TYPE_SCENARIO_VALUES as readonly string[])
  typeScenario?: TypeScenario;

  @ApiPropertyOptional({ example: 'Mise à jour hypothèses' })
  @IsOptional()
  @IsString()
  commentaire?: string;

  @ApiPropertyOptional({ example: 2027, minimum: 2020, maximum: 2050 })
  @IsOptional()
  @IsInt()
  @Min(2020)
  @Max(2050)
  exerciceFiscal?: number;
}
