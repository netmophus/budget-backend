import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

function toBoolean(value: unknown): unknown {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}

export class ListRefSecondaireDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit: number = 50;

  @ApiPropertyOptional({ description: "Filtre est_actif (true/false)." })
  @IsOptional()
  @Transform(({ value }) => toBoolean(value))
  @IsBoolean()
  estActif?: boolean;

  @ApiPropertyOptional({ description: "Filtre est_systeme (true/false)." })
  @IsOptional()
  @Transform(({ value }) => toBoolean(value))
  @IsBoolean()
  estSysteme?: boolean;

  @ApiPropertyOptional({ description: 'Recherche LIKE %libelle%.', maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;
}

export class PaginatedRefSecondaireDto<T> {
  items!: T[];
  total!: number;
  page!: number;
  limit!: number;
}
