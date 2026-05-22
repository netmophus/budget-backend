import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';

export type ActionVisa = 'VISER' | 'REJETER';

/**
 * DTO entrée `POST /documents-officiels/documents/:id/visa`
 * (Lot 8.1.C).
 *
 * Le service appliquera la contrainte metier "commentaire obligatoire
 * si action=REJETER" (BadRequest sinon). La contrainte DB
 * `ck_visa_commentaire_si_rejet` est la 2e ligne de defense.
 */
export class ApporterVisaDto {
  @ApiProperty({ enum: ['VISER', 'REJETER'] })
  @IsIn(['VISER', 'REJETER'])
  action!: ActionVisa;

  @ApiPropertyOptional({
    description:
      'Commentaire libre. OBLIGATOIRE si action=REJETER (validation metier service).',
  })
  @IsOptional()
  @IsString()
  commentaire?: string;
}
