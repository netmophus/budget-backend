import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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

export class CreateRefSecondaireDto {
  @ApiProperty({
    example: 'succursale',
    description:
      "Code business stable (ex. 'agence'). Format permissif (1-50 caractères, peut contenir lettres / chiffres / _ / -). Le caller décide de la casse — on ne force pas pour rester compatible avec les codes existants ('CIV' vs 'agence' vs 'CREATE').",
  })
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  @Matches(/^[A-Za-z0-9_-]+$/, {
    message: "code doit contenir uniquement lettres, chiffres, _ ou -",
  })
  code!: string;

  @ApiProperty({ example: 'Succursale', maxLength: 200 })
  @IsString()
  @MaxLength(200)
  libelle!: string;

  @ApiPropertyOptional({
    example: "Point de vente sans personnel permanent.",
    description: 'Description libre (markdown autorisé en lecture).',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    example: 60,
    default: 0,
    description: 'Ordre d\'affichage dans les selects UI (croissant).',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(99999)
  ordre?: number;
}
