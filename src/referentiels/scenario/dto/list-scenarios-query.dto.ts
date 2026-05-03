import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

import type {
  StatutScenario,
  TypeScenario,
} from '../entities/dim-scenario.entity';

const TYPE_SCENARIO_VALUES: readonly TypeScenario[] = [
  'central',
  'optimiste',
  'pessimiste',
  'alternatif',
];

const STATUT_SCENARIO_VALUES: readonly StatutScenario[] = ['actif', 'archive'];

export class ListScenariosQueryDto {
  @ApiPropertyOptional({ example: 1, default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ example: 50, default: 50, minimum: 1, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit: number = 50;

  @ApiPropertyOptional({ enum: STATUT_SCENARIO_VALUES })
  @IsOptional()
  @IsIn(STATUT_SCENARIO_VALUES as readonly string[])
  statut?: StatutScenario;

  @ApiPropertyOptional({ enum: TYPE_SCENARIO_VALUES })
  @IsOptional()
  @IsIn(TYPE_SCENARIO_VALUES as readonly string[])
  typeScenario?: TypeScenario;

  @ApiPropertyOptional({ example: 2027, minimum: 2020, maximum: 2050 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2020)
  @Max(2050)
  exerciceFiscal?: number;
}
