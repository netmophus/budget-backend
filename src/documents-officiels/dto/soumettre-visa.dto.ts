import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';

import type { ModeVisa } from '../entities/campagne-budgetaire.entity';

/**
 * DTO entrée `POST /documents-officiels/documents/:id/soumettre-visa`
 * (Lot 8.1.C).
 *
 * Corps optionnel (peut être {}) — la spec n'exige rien. Le champ
 * `modeVisaOverride` permet de basculer ponctuellement un document
 * d'une campagne PARALLELE vers SEQUENTIEL (ou inverse) sans toucher
 * a la campagne. Servira au Lot 8.2 pour des cas exceptionnels.
 */
export class SoumettreVisaDto {
  @ApiPropertyOptional({
    enum: ['PARALLELE', 'SEQUENTIEL'],
    description:
      'Override ponctuel du mode visa de la campagne pour ce document.',
  })
  @IsOptional()
  @IsIn(['PARALLELE', 'SEQUENTIEL'])
  modeVisaOverride?: ModeVisa;
}
