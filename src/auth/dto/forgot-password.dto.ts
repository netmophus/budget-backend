import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, Length, MaxLength } from 'class-validator';

import { MotDePasseValide } from '../password-policy';

/**
 * DTO POST /auth/forgot-password — body { email }.
 *
 * Validation minimale : format email + longueur. La logique
 * anti-énumération (réponse identique pour email connu/inconnu) est
 * gérée par le service.
 */
export class ForgotPasswordDto {
  @ApiProperty({ example: 'jean.dupont@bsic.ne', maxLength: 255 })
  @IsEmail({}, { message: 'Email invalide.' })
  @MaxLength(255)
  email!: string;
}

/**
 * DTO POST /auth/reset-password — body { token, nouveauMdp }.
 * Le token est l'UUID clair reçu par email (le service recalcule son
 * hash SHA-256 pour le matcher en base).
 */
export class ResetPasswordDto {
  @ApiProperty({
    example: '0fb8a4f3-4d9c-4f5a-a4cf-1c2d3e4f5a6b',
    description: 'Token reçu par email (UUID v4 en clair).',
  })
  @IsString({ message: 'Token requis.' })
  @Length(8, 128, { message: 'Token : longueur invalide.' })
  token!: string;

  @ApiProperty({
    minLength: 12,
    description: 'Nouveau mot de passe — au moins 12 caractères + complexité.',
  })
  @MotDePasseValide()
  nouveauMdp!: string;
}
