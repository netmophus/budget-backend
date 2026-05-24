/**
 * DTO d'upsert du détail métier d'une Lettre de cadrage (Lot 8.2.C).
 *
 * Tous les champs sont optionnels : le DG peut sauvegarder un draft
 * incomplet avant d'avoir tous les chiffres définitifs. La validation
 * stricte d'exhaustivité est faite au moment de la soumission au
 * visa (workflow document parent), pas ici.
 *
 * Convention NUMERIC : reçu en string côté DTO (préserve la précision
 * pg sans conversion en `number` lossy). `@IsNumberString` valide
 * que la chaîne représente bien un nombre parsable.
 *
 * Convention DATE : reçue en ISO string `YYYY-MM-DD`. `@IsDateString`
 * valide le format avant que TypeORM ne tente la conversion vers
 * `Date`. Les contraintes CHECK SQL ck_ratios_dans_plage gardent
 * une 2ème couche de validation côté DB (défense en profondeur).
 */
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsNumberString,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreerOuMettreAJourLettreCadrageDetailDto {
  // ─── En-tête Holding ────────────────────────────────────────────

  @ApiPropertyOptional({ example: 'CA/BSIC-HOLDING/2025/047' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  referenceHolding?: string | null;

  @ApiPropertyOptional({ example: '2025-06-15', format: 'date' })
  @IsOptional()
  @IsDateString()
  dateEmissionHolding?: string | null;

  @ApiPropertyOptional({ example: 'Yacouba HAROUNA, Pdt CA Holding' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  signataireHolding?: string | null;

  // ─── Objectifs quantitatifs ─────────────────────────────────────

  @ApiPropertyOptional({
    example: '12500.00',
    description: 'PNB cible en M FCFA',
  })
  @IsOptional()
  @IsNumberString()
  pnbCibleMfcfa?: string | null;

  @ApiPropertyOptional({
    example: '1850.00',
    description: 'RN cible en M FCFA',
  })
  @IsOptional()
  @IsNumberString()
  rnCibleMfcfa?: string | null;

  @ApiPropertyOptional({
    example: '12.50',
    description: 'Croissance crédits %',
  })
  @IsOptional()
  @IsNumberString()
  croissanceCreditsPct?: string | null;

  @ApiPropertyOptional({ example: '8.00', description: 'Croissance dépôts %' })
  @IsOptional()
  @IsNumberString()
  croissanceDepotsPct?: string | null;

  @ApiPropertyOptional({
    example: '55.00',
    description: "Coefficient d'exploitation %",
  })
  @IsOptional()
  @IsNumberString()
  coefficientExploitationPct?: string | null;

  @ApiPropertyOptional({ example: '15.00', description: 'ROE cible %' })
  @IsOptional()
  @IsNumberString()
  roeCiblePct?: string | null;

  // ─── Ratios prudentiels BCEAO ───────────────────────────────────

  @ApiPropertyOptional({ example: '11.50' })
  @IsOptional()
  @IsNumberString()
  ratioSolvabiliteMinPct?: string | null;

  @ApiPropertyOptional({ example: '75.00' })
  @IsOptional()
  @IsNumberString()
  ratioLiquiditeMinPct?: string | null;

  @ApiPropertyOptional({ example: '25.00' })
  @IsOptional()
  @IsNumberString()
  ratioDivisionRisquesPct?: string | null;

  // ─── Calendrier ─────────────────────────────────────────────────

  @ApiPropertyOptional({ example: '2026-08-01', format: 'date' })
  @IsOptional()
  @IsDateString()
  dateDebutSaisie?: string | null;

  @ApiPropertyOptional({ example: '2026-09-30', format: 'date' })
  @IsOptional()
  @IsDateString()
  dateLimiteSaisieCr?: string | null;

  @ApiPropertyOptional({ example: '2026-10-15', format: 'date' })
  @IsOptional()
  @IsDateString()
  dateValidationDga?: string | null;

  @ApiPropertyOptional({ example: '2026-11-15', format: 'date' })
  @IsOptional()
  @IsDateString()
  dateValidationDg?: string | null;

  @ApiPropertyOptional({ example: '2026-12-15', format: 'date' })
  @IsOptional()
  @IsDateString()
  datePublicationBceao?: string | null;

  // ─── Orientations stratégiques ──────────────────────────────────

  @ApiPropertyOptional({
    example:
      'Priorité à la transformation digitale et au renforcement du Tier 1.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  orientationsStrategiques?: string | null;
}
