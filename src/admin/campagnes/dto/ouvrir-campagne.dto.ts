/**
 * DTO POST /admin/campagnes/:versionId/ouvrir (Lot 6.6 — E14).
 *
 * Tous les champs sont optionnels :
 *  - dateOuverture par défaut = NOW()
 *  - dateFermeture par défaut = NOW() + 90 jours
 *  - commentaire libre, max 500 caractères (limite raisonnable pour
 *    un email — éviter le mur de texte qui briserait la mise en page).
 */
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';

export class OuvrirCampagneDto {
  @ApiPropertyOptional({
    description:
      "Date d'ouverture de la campagne (ISO 8601). Par défaut = NOW().",
    example: '2026-08-01',
  })
  @IsOptional()
  @IsDateString()
  dateOuverture?: string;

  @ApiPropertyOptional({
    description:
      'Date de fermeture de la campagne (ISO 8601). Par défaut = NOW() + 90 jours.',
    example: '2026-10-31',
  })
  @IsOptional()
  @IsDateString()
  dateFermeture?: string;

  @ApiPropertyOptional({
    description:
      "Note libre de la Direction affichée dans l'email aux saisisseurs / validateurs.",
    maxLength: 500,
    example:
      "Conformément à la lettre DG du 07/07/2026, la phase de saisie démarre dès aujourd'hui.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  commentaire?: string;
}
