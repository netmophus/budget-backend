import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * DTOs Lot Administration — CRUD utilisateurs et gestion des rôles.
 * Validation stricte côté API (longueurs, format email, mot de passe
 * minimum 12 caractères).
 */

export class CreerUserDto {
  @ApiProperty({ example: 'test.demo@miznas.local' })
  @IsEmail({}, { message: 'Email invalide.' })
  @MaxLength(255)
  email!: string;

  @ApiProperty({ example: 'Diallo' })
  @IsString()
  @Length(2, 100)
  nom!: string;

  @ApiProperty({ example: 'Aïcha' })
  @IsString()
  @Length(2, 100)
  prenom!: string;

  @ApiProperty({
    minLength: 12,
    description: 'Mot de passe initial — au moins 12 caractères.',
  })
  @IsString()
  @MinLength(12, { message: 'Mot de passe : minimum 12 caractères.' })
  motDePasseInitial!: string;

  @ApiProperty({
    type: [String],
    description: 'Liste des fk_role à attribuer (≥ 1).',
    example: ['3', '4'],
  })
  @IsArray()
  @ArrayMinSize(1, { message: 'Au moins un rôle doit être attribué.' })
  @IsString({ each: true })
  fkRoles!: string[];
}

export class ModifierUserDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(2, 100)
  nom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(2, 100)
  prenom?: string;
}

export class MotifDto {
  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  motif?: string;
}

export class AttribuerRoleDto {
  @ApiProperty({ description: 'fk_role à attribuer.' })
  @IsString()
  fkRole!: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  motif?: string;
}

export class ResetPasswordResponseDto {
  /**
   * Lot 6.4.C — breaking change : le mot de passe temporaire n'est
   * plus retourné dans la réponse API. Il est généré côté serveur,
   * envoyé par email à l'utilisateur (queue BullMQ Lot 6.3) et
   * jamais stocké en clair (ni en base, ni en log applicatif).
   * L'admin reçoit juste une confirmation que l'email a été publié.
   */
  @ApiProperty({ example: true })
  success!: boolean;

  @ApiProperty({
    example: 'Email de réinitialisation envoyé à user@miznas.local.',
  })
  message!: string;
}

export class HistoriqueConnexionItemDto {
  @ApiProperty()
  id!: string;
  @ApiProperty()
  dateAction!: string;
  @ApiProperty()
  typeAction!: string;
  @ApiProperty()
  statut!: string;
  @ApiPropertyOptional()
  ipSource?: string | null;
  @ApiPropertyOptional()
  userAgent?: string | null;
}

export class UserRoleResumeDto {
  @ApiProperty()
  id!: string;
  @ApiProperty()
  fkRole!: string;
  @ApiProperty()
  codeRole!: string;
  @ApiProperty()
  libelle!: string;
  @ApiProperty()
  estActif!: boolean;
  @ApiProperty()
  dateCreation!: string;
}
