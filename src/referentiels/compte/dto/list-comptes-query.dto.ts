import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const CLASSES_PCB: readonly string[] = [
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
];

export class ListComptesQueryDto {
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

  @ApiPropertyOptional({ example: '6', enum: CLASSES_PCB })
  @IsOptional()
  @IsString()
  @IsIn(CLASSES_PCB)
  classe?: string;

  /**
   * Liste de classes (CSV ou répétition `?classes=6&classes=7`).
   * Mutuellement exclusif avec `classe` (qui prime si fourni).
   * Utilisé par le sélecteur compte de la saisie budgétaire pour
   * ne ramener que classes 6 et 7.
   */
  @ApiPropertyOptional({
    example: '6,7',
    description:
      'Liste de classes (CSV `6,7` ou répété `classes=6&classes=7`).',
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (Array.isArray(value))
      return value.map((v) => String(v).trim()).filter((s) => s.length > 0);
    if (typeof value === 'string') {
      return value
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    }
    return value;
  })
  @IsString({ each: true })
  @IsIn(CLASSES_PCB, { each: true })
  classes?: string[];

  @ApiPropertyOptional({
    description: 'Filtre LIKE %libelle% case-insensitive.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @ApiPropertyOptional({ example: 'MASSE_SALARIALE', maxLength: 50 })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  codePosteBudgetaire?: string;

  @ApiPropertyOptional({ example: true, default: true })
  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value === 'boolean') return value;
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  @IsBoolean()
  versionCouranteUniquement: boolean = true;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value === 'boolean') return value;
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  @IsBoolean()
  estCompteCollectif?: boolean;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value === 'boolean') return value;
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  @IsBoolean()
  estPorteurInterets?: boolean;
}
