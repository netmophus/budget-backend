import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsUUID } from 'class-validator';

import type { StatutDocument } from '../entities/document-officiel.entity';
import {
  TYPES_DOCUMENT_AUTORISES,
  type TypeDocument,
} from './creer-document.dto';

export type RoleSurDocument = 'emetteur' | 'viseur_en_attente' | 'signataire';

/**
 * Query string `GET /documents-officiels/documents` (Lot 8.1.C).
 *
 * `monRole` filtre par perspective utilisateur — utile pour les ecrans
 * "Mes documents a viser" / "Mes documents en attente de signature" /
 * "Mes brouillons".
 */
export class ListerDocumentsQueryDto {
  @ApiPropertyOptional({
    enum: ['BROUILLON', 'SOUMIS_VISA', 'VISE', 'SIGNE', 'ARCHIVE'],
  })
  @IsOptional()
  @IsIn(['BROUILLON', 'SOUMIS_VISA', 'VISE', 'SIGNE', 'ARCHIVE'])
  statut?: StatutDocument;

  @ApiPropertyOptional({ enum: TYPES_DOCUMENT_AUTORISES })
  @IsOptional()
  @IsIn(TYPES_DOCUMENT_AUTORISES as readonly string[])
  typeDocument?: TypeDocument;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  fkCampagne?: string;

  @ApiPropertyOptional({
    enum: ['emetteur', 'viseur_en_attente', 'signataire'],
  })
  @IsOptional()
  @IsIn(['emetteur', 'viseur_en_attente', 'signataire'])
  monRole?: RoleSurDocument;
}
