/**
 * DTO pour PATCH /api/v1/me/password (Lot 6.4.A).
 *
 * `nouveauMdp` valide la politique partagée (≥12 caractères + maj +
 * minuscule + chiffre + spécial) via le décorateur
 * `@MotDePasseValide()`. La vérification "ancienMdp correct" et
 * "nouveau != ancien" est faite côté service (cf.
 * AuthService.changerMdp) car elle dépend du hash en base.
 */
import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

import { MotDePasseValide } from '../password-policy';

export class ChangerMdpDto {
  @ApiProperty({ description: 'Mot de passe actuel.' })
  @IsString()
  @IsNotEmpty()
  ancienMdp!: string;

  @ApiProperty({
    description:
      'Nouveau mot de passe (≥12 chars, ≥1 majuscule, ≥1 minuscule, ' +
      '≥1 chiffre, ≥1 caractère spécial).',
  })
  @IsString()
  @MotDePasseValide()
  nouveauMdp!: string;
}
