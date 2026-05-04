import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * DTOs des transitions du workflow de validation budgétaire (Lot 3.5).
 *
 *  - Soumettre / Valider / Publier : commentaire **optionnel**.
 *  - Rejeter : commentaire **obligatoire** (le contrôleur doit motiver
 *    le rejet pour que le préparateur puisse corriger).
 */

export class SoumettreVersionDto {
  @ApiPropertyOptional({
    example: 'Cadrage initial DG, à valider en comité',
    maxLength: 2000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  commentaire?: string;
}

export class ValiderVersionDto {
  @ApiPropertyOptional({
    example: 'Validé sous réserve d’ajustement Q3',
    maxLength: 2000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  commentaire?: string;
}

export class RejeterVersionDto {
  @ApiProperty({
    example:
      "Coefficient d'exploitation à 105% — le scénario MEDIAN n'est pas viable. Revoir l'allocation des charges support.",
    description:
      'Motif de rejet (obligatoire). Sera communiqué au préparateur ' +
      'pour qu’il puisse corriger et re-soumettre la version.',
    maxLength: 2000,
  })
  @IsString()
  @IsNotEmpty({
    message: 'Le commentaire de rejet est obligatoire.',
  })
  @MaxLength(2000)
  commentaire!: string;
}

export class PublierVersionDto {
  @ApiPropertyOptional({
    example: 'Publication exercice 2027 — comité ALCO 30/03/2027',
    maxLength: 2000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  commentaire?: string;
}
