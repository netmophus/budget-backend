import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateDeviseDto {
  @ApiProperty({ example: 'JPY', description: 'Code ISO 4217 (3 lettres majuscules).' })
  @IsString()
  @Length(3, 3)
  @Matches(/^[A-Z]{3}$/, { message: 'codeIso doit être 3 lettres majuscules' })
  codeIso!: string;

  @ApiProperty({ example: 'Yen japonais', maxLength: 100 })
  @IsString()
  @MaxLength(100)
  libelle!: string;

  @ApiPropertyOptional({ example: '¥', maxLength: 10 })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  symbole?: string;

  @ApiPropertyOptional({ example: 2, default: 2, minimum: 0, maximum: 8 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(8)
  nbDecimales?: number;

  @ApiPropertyOptional({ example: false, default: false })
  @IsOptional()
  @IsBoolean()
  estDevisePivot?: boolean;
}
