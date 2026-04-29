import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class ListFaitBudgetQueryDto {
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

  // ─── Filtres FK directes (bigints serialisés)

  @ApiPropertyOptional({ example: '2' })
  @IsOptional()
  @IsString()
  @Matches(/^\d+$/)
  fkVersion?: string;

  @ApiPropertyOptional({ example: '1' })
  @IsOptional()
  @IsString()
  @Matches(/^\d+$/)
  fkScenario?: string;

  @ApiPropertyOptional({ example: '123' })
  @IsOptional()
  @IsString()
  @Matches(/^\d+$/)
  fkTemps?: string;

  @ApiPropertyOptional({ example: '12' })
  @IsOptional()
  @IsString()
  @Matches(/^\d+$/)
  fkCentre?: string;

  @ApiPropertyOptional({ example: '42' })
  @IsOptional()
  @IsString()
  @Matches(/^\d+$/)
  fkCompte?: string;

  // ─── Filtres par codes business (résolus en FK côté service)

  @ApiPropertyOptional({ example: 'BUDGET_INITIAL_2026' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  codeVersion?: string;

  @ApiPropertyOptional({ example: 'CENTRAL' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  codeScenario?: string;

  // ─── Filtres période (via dim_temps)

  @ApiPropertyOptional({ example: 2026, minimum: 2020, maximum: 2050 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2020)
  @Max(2050)
  annee?: number;

  @ApiPropertyOptional({ example: 4, minimum: 1, maximum: 12 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  mois?: number;
}
