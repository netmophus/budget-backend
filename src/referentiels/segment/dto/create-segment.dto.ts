import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, Matches, MaxLength } from 'class-validator';

import type { CategorieSegment } from '../entities/dim-segment.entity';

const CATEGORIE_VALUES: readonly CategorieSegment[] = [
  'particulier',
  'professionnel',
  'pme',
  'grande_entreprise',
  'institutionnel',
  'secteur_public',
];

export class CreateSegmentDto {
  @ApiProperty({
    example: 'PME',
    description: 'Business key — alphanumérique + underscore.',
  })
  @IsString()
  @MaxLength(50)
  @Matches(/^[A-Z0-9_]+$/, {
    message:
      'codeSegment doit contenir uniquement des majuscules, chiffres et underscores',
  })
  codeSegment!: string;

  @ApiProperty({ example: 'Petites et moyennes entreprises', maxLength: 200 })
  @IsString()
  @MaxLength(200)
  libelle!: string;

  @ApiProperty({ enum: CATEGORIE_VALUES, example: 'pme' })
  @IsIn(CATEGORIE_VALUES as readonly string[])
  categorie!: CategorieSegment;
}
