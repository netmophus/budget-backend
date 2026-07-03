import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

import {
  FONCTIONS_COMITE,
  type FonctionComite,
} from '../entities/configuration-banque-membre-comite.entity';

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

// ─── Membres du Comité ─────────────────────────────────────────────

export class MembreComiteResponseDto {
  @ApiProperty({ example: '1' })
  id!: string;

  @ApiProperty({ example: 'Souleymane DIORI' })
  nomPrenom!: string;

  @ApiPropertyOptional({ example: 'M.' })
  titre!: string | null;

  @ApiProperty({ enum: FONCTIONS_COMITE, example: 'PRESIDENT' })
  fonction!: FonctionComite;

  @ApiProperty({ example: 1 })
  ordreAffichage!: number;

  @ApiProperty({ example: true })
  estActif!: boolean;
}

export class CreateMembreComiteDto {
  @ApiProperty({ example: 'Souleymane DIORI' })
  @IsString()
  @MaxLength(200)
  nomPrenom!: string;

  @ApiPropertyOptional({ example: 'M.' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  titre?: string;

  @ApiProperty({ enum: FONCTIONS_COMITE })
  @IsIn(FONCTIONS_COMITE)
  fonction!: FonctionComite;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  @Min(0)
  ordreAffichage?: number;
}

export class UpdateMembreComiteDto {
  @ApiPropertyOptional({ example: 'Souleymane DIORI' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  nomPrenom?: string;

  @ApiPropertyOptional({ example: 'M.' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  titre?: string;

  @ApiPropertyOptional({ enum: FONCTIONS_COMITE })
  @IsOptional()
  @IsIn(FONCTIONS_COMITE)
  fonction?: FonctionComite;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  @Min(0)
  ordreAffichage?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  estActif?: boolean;
}

// ─── Configuration banque — réponse interne complète ───────────────

export class ConfigurationBanqueResponseDto {
  @ApiProperty({ example: 'BSIC NIGER' })
  nom!: string;

  @ApiProperty({ example: 'BSIC' })
  sigle!: string;

  @ApiPropertyOptional()
  nomCommercialComplet!: string | null;

  @ApiPropertyOptional()
  formeJuridique!: string | null;

  @ApiPropertyOptional()
  groupe!: string | null;

  @ApiPropertyOptional()
  siegeSocial!: string | null;

  @ApiPropertyOptional()
  villeSiege!: string | null;

  @ApiPropertyOptional()
  pays!: string | null;

  @ApiPropertyOptional()
  telephone!: string | null;

  @ApiPropertyOptional()
  emailContact!: string | null;

  @ApiPropertyOptional()
  refReglementaireBceao!: string | null;

  @ApiPropertyOptional()
  exerciceFiscalLibelle!: string | null;

  @ApiProperty({ example: '#1B2A4E' })
  couleurPrimaire!: string;

  @ApiProperty({ example: '#0F1B33' })
  couleurPrimaireDark!: string;

  @ApiProperty({ example: '#C49B3F' })
  couleurSecondaire!: string;

  @ApiPropertyOptional()
  logoRef!: string | null;

  @ApiPropertyOptional()
  contexteMarche!: string | null;

  @ApiPropertyOptional()
  concurrents!: string | null;

  @ApiPropertyOptional()
  positionnement!: string | null;

  @ApiProperty({ type: [MembreComiteResponseDto] })
  membres!: MembreComiteResponseDto[];
}

// ─── Configuration banque — réponse PUBLIQUE (whitelist stricte) ───

/**
 * Version publique exposée SANS authentification (splash / login). NE
 * DOIT contenir QUE des champs non sensibles — pas de membres Comité,
 * pas de contexte marché/positionnement.
 */
export class ConfigurationBanquePubliqueDto {
  @ApiProperty({ example: 'BSIC NIGER' })
  nom!: string;

  @ApiProperty({ example: 'BSIC' })
  sigle!: string;

  @ApiPropertyOptional()
  nomCommercialComplet!: string | null;

  @ApiPropertyOptional()
  villeSiege!: string | null;

  @ApiPropertyOptional()
  pays!: string | null;

  @ApiProperty({ example: '#1B2A4E' })
  couleurPrimaire!: string;

  @ApiProperty({ example: '#0F1B33' })
  couleurPrimaireDark!: string;

  @ApiProperty({ example: '#C49B3F' })
  couleurSecondaire!: string;

  @ApiPropertyOptional()
  logoRef!: string | null;
}

// ─── Mise à jour de la configuration (PUT) ─────────────────────────

export class UpdateConfigurationBanqueDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  nom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  sigle?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  nomCommercialComplet?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  formeJuridique?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  groupe?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  siegeSocial?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  villeSiege?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  pays?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  telephone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  emailContact?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  refReglementaireBceao?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  exerciceFiscalLibelle?: string;

  @ApiPropertyOptional({ example: '#1B2A4E' })
  @IsOptional()
  @Matches(HEX_COLOR, { message: 'couleurPrimaire doit être un hex #RRGGBB.' })
  couleurPrimaire?: string;

  @ApiPropertyOptional({ example: '#0F1B33' })
  @IsOptional()
  @Matches(HEX_COLOR, {
    message: 'couleurPrimaireDark doit être un hex #RRGGBB.',
  })
  couleurPrimaireDark?: string;

  @ApiPropertyOptional({ example: '#C49B3F' })
  @IsOptional()
  @Matches(HEX_COLOR, {
    message: 'couleurSecondaire doit être un hex #RRGGBB.',
  })
  couleurSecondaire?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  logoRef?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  contexteMarche?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  concurrents?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  positionnement?: string;
}
