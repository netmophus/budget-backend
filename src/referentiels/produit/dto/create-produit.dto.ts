import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import type { TypeProduit } from '../entities/dim-produit.entity';

const TYPE_PRODUIT_VALUES: readonly TypeProduit[] = [
  'credit',
  'depot',
  'service',
  'marche',
  'autre',
];

export class CreateProduitDto {
  @ApiProperty({
    example: 'CREDIT_DECOUVERT',
    description: 'Business key — alphanumérique + underscore.',
  })
  @IsString()
  @MaxLength(50)
  @Matches(/^[A-Z0-9_]+$/, {
    message:
      'codeProduit doit contenir uniquement des majuscules, chiffres et underscores',
  })
  codeProduit!: string;

  @ApiProperty({ example: 'Découverts particuliers', maxLength: 200 })
  @IsString()
  @MaxLength(200)
  libelle!: string;

  @ApiProperty({ enum: TYPE_PRODUIT_VALUES, example: 'credit' })
  @IsIn(TYPE_PRODUIT_VALUES as readonly string[])
  typeProduit!: TypeProduit;

  @ApiPropertyOptional({ example: '12' })
  @IsOptional()
  @IsString()
  fkProduitParent?: string;

  @ApiPropertyOptional({
    example: 'CREDIT_TRESORERIE',
    description: 'Business key du parent. Résolu côté service.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  codeProduitParent?: string;

  @ApiProperty({ example: 3, minimum: 1, maximum: 4 })
  @IsInt()
  @Min(1)
  @Max(4)
  niveau!: number;

  @ApiPropertyOptional({ example: false, default: false })
  @IsOptional()
  @IsBoolean()
  estPorteurInterets?: boolean;
}
