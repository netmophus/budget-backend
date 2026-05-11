import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Matches, Max, Min } from 'class-validator';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class ListTempsQueryDto {
  @ApiPropertyOptional({ example: 1, default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  /**
   * Plafond à 366 (≥ 1 année calendaire complète, bissextile incluse) —
   * cf. brief 2.2A §2.4 « limit 366 max ».
   */
  @ApiPropertyOptional({ example: 31, default: 366, minimum: 1, maximum: 366 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(366)
  limit: number = 366;

  @ApiPropertyOptional({
    example: '2026-01-01',
    description: 'Borne basse (incluse), format YYYY-MM-DD.',
  })
  @IsOptional()
  @Matches(ISO_DATE, { message: 'dateDebut doit être au format YYYY-MM-DD' })
  dateDebut?: string;

  @ApiPropertyOptional({
    example: '2026-12-31',
    description: 'Borne haute (incluse), format YYYY-MM-DD.',
  })
  @IsOptional()
  @Matches(ISO_DATE, { message: 'dateFin doit être au format YYYY-MM-DD' })
  dateFin?: string;

  @ApiPropertyOptional({ example: 2026 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1900)
  @Max(2999)
  annee?: number;

  @ApiPropertyOptional({ example: 1, minimum: 1, maximum: 12 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  mois?: number;

  @ApiPropertyOptional({ example: 2026 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1900)
  @Max(2999)
  exerciceFiscal?: number;
}
