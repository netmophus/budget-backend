import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/**
 * DTO entrée `POST /documents-officiels/documents` (Lot 8.1.C).
 *
 * `typeDocument` est borné à une whitelist (Lot 8.1.B). Les autres
 * types pourront être ajoutés au fil des paliers Lot 8.x.
 */
export const TYPES_DOCUMENT_AUTORISES = [
  'D2_LETTRE_CADRAGE',
  'D3_NOTE_ORIENTATION',
  'D5_LETTRE_DG',
  'R3_BORDEREAU_VALIDATION',
  'R5_BORDEREAU_REJET',
  'D11_PV_APPROBATION',
  'D12_LETTRE_OFFICIALISATION',
] as const;

export type TypeDocument = (typeof TYPES_DOCUMENT_AUTORISES)[number];

export class CreerDocumentDto {
  @ApiProperty({ example: 'LETTRE_CADRAGE_2026' })
  @IsString()
  @MaxLength(50)
  codeDocument!: string;

  @ApiProperty({ enum: TYPES_DOCUMENT_AUTORISES })
  @IsIn(TYPES_DOCUMENT_AUTORISES as readonly string[])
  typeDocument!: TypeDocument;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  fkCampagne!: string;

  @ApiProperty({ example: 'Lettre de cadrage budgétaire 2026' })
  @IsString()
  @MaxLength(255)
  titre!: string;

  @ApiProperty({ description: 'Contenu HTML rendu canonique' })
  @IsString()
  contenuHtml!: string;

  @ApiPropertyOptional({ example: 'REF-BSIC-HOLDING-2026-001' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  referenceExterne?: string;

  @ApiProperty({ example: '23', description: 'BIGINT user.id stringifié' })
  @IsString()
  fkUserSignataire!: string;

  @ApiPropertyOptional({
    example: '12',
    description: 'BIGINT dim_version.id stringifié',
  })
  @IsOptional()
  @IsString()
  fkVersionBudget?: string;
}
