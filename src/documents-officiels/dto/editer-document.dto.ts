import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * DTO entrée `PATCH /documents-officiels/documents/:id` (Lot 8.1.C).
 *
 * Tous les champs sont optionnels — l'editeur frontend (TipTap ou
 * equivalent) peut envoyer juste les champs modifies. Validation
 * metier (statut === BROUILLON) faite cote service.
 */
export class EditerDocumentDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  titre?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  contenuHtml?: string;

  @ApiPropertyOptional({ description: 'AST optionnel TipTap ou equivalent' })
  @IsOptional()
  @IsObject()
  contenuJson?: object;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  referenceExterne?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  fichierJointPath?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  fichierJointNom?: string;
}
