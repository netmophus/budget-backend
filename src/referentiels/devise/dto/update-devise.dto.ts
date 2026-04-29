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
 * `code_iso` est volontairement absent : le code ISO est immuable
 * (référence stable côté faits comptables). Pour changer un code,
 * passer par `desactiver` puis `create`.
 */
export class UpdateDeviseDto {
  @ApiPropertyOptional({ example: 'Yen japonais', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  libelle?: string;

  @ApiPropertyOptional({ example: '¥', maxLength: 10 })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  symbole?: string;

  @ApiPropertyOptional({ example: 2, minimum: 0, maximum: 8 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(8)
  nbDecimales?: number;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  estDevisePivot?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  estActive?: boolean;
}
