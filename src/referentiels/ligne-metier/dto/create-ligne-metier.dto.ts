import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateLigneMetierDto {
  @ApiProperty({
    example: 'RETAIL_PARTICULIERS',
    description: 'Business key — alphanumérique + underscore.',
  })
  @IsString()
  @MaxLength(50)
  @Matches(/^[A-Z0-9_]+$/, {
    message:
      'codeLigneMetier doit contenir uniquement des majuscules, chiffres et underscores',
  })
  codeLigneMetier!: string;

  @ApiProperty({ example: 'Particuliers', maxLength: 200 })
  @IsString()
  @MaxLength(200)
  libelle!: string;

  @ApiPropertyOptional({
    example: '12',
    description: 'Surrogate key du parent (version courante).',
  })
  @IsOptional()
  @IsString()
  fkLigneMetierParent?: string;

  @ApiPropertyOptional({
    example: 'RETAIL',
    description: 'Business key du parent. Résolu côté service.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  codeLigneMetierParent?: string;

  @ApiProperty({ example: 2, minimum: 1, maximum: 4 })
  @IsInt()
  @Min(1)
  @Max(4)
  niveau!: number;
}
