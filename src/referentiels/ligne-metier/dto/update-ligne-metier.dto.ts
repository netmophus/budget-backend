import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * `codeLigneMetier` est immuable. Sémantique 4-cas
 * (cf. `scd2-pattern.md` §7).
 */
export class UpdateLigneMetierDto {
  @ApiPropertyOptional({ example: 'Particuliers (rénové)', maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  libelle?: string;

  @ApiPropertyOptional({ example: '12' })
  @IsOptional()
  @IsString()
  fkLigneMetierParent?: string;

  @ApiPropertyOptional({ example: 'RETAIL' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  codeLigneMetierParent?: string;

  @ApiPropertyOptional({ example: 2, minimum: 1, maximum: 4 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(4)
  niveau?: number;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  estActif?: boolean;
}
