import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * Pas de `code` ici : la business key est immuable côté UX, ET le
 * service la refuse explicitement si `estSysteme=true` côté backend.
 * Si un admin veut renommer un code custom, il doit DELETE + CREATE
 * (les FK varchar dans les dimensions ne référencent pas l'id).
 */
export class UpdateRefSecondaireDto {
  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  libelle?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string | null;

  @ApiPropertyOptional({ minimum: 0, maximum: 99999 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(99999)
  ordre?: number;

  @ApiPropertyOptional({
    description: 'Active / désactive la valeur (toggle est_actif).',
  })
  @IsOptional()
  @IsBoolean()
  estActif?: boolean;

  /**
   * Permet de renommer une valeur custom (estSysteme=false). Refusé
   * côté service si estSysteme=true (le code applicatif s'appuie sur
   * ces codes pour le workflow). Format aligné sur Create.
   */
  @ApiPropertyOptional({
    description: 'Renommer le code (refusé si estSysteme=true).',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  @Matches(/^[A-Za-z0-9_-]+$/)
  code?: string;
}
