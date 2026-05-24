/**
 * DTO d'upsert du détail métier d'une Lettre de mobilisation
 * (Lot 8.3.B).
 *
 * Pattern strictement aligné Lot 8.3.A (DTO Note d'orientation).
 * Tous les champs sont optionnels (draft incomplet autorisé en
 * BROUILLON). Validation stricte du format au niveau DTO + 2ème
 * couche CHECK SQL côté DB (défense en profondeur).
 *
 * `messageDgHtml` : HTML généré par TipTap côté frontend. TipTap
 * émet du HTML sécurisé par défaut (whitelist d'éléments, pas de
 * `<script>` ni d'attributs `on*`). Max 10 000 chars pour limiter
 * l'abus.
 */
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreerOuMettreAJourLettreMobilisationDetailDto {
  // ─── En-tête lettre officielle ──────────────────────────────────

  @ApiPropertyOptional({ example: 'DG/BSIC-NIGER/2028/MOBIL-01' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  referenceLettre?: string | null;

  @ApiPropertyOptional({ example: '2027-12-15', format: 'date' })
  @IsOptional()
  @IsDateString()
  dateEmission?: string | null;

  @ApiPropertyOptional({
    example:
      'Direction Réseau, Direction Crédits, Direction Conformité, ' +
      'Direction Risques, Direction RH, Direction IT, Direction Audit',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  destinatairesDirections?: string | null;

  // ─── Période d'exécution ────────────────────────────────────────

  @ApiPropertyOptional({ example: 2028, minimum: 2020, maximum: 2050 })
  @IsOptional()
  @IsInt()
  @Min(2020)
  @Max(2050)
  exerciceConcerne?: number | null;

  @ApiPropertyOptional({ example: '2028-01-01', format: 'date' })
  @IsOptional()
  @IsDateString()
  dateDebutExecution?: string | null;

  @ApiPropertyOptional({ example: '2028-12-31', format: 'date' })
  @IsOptional()
  @IsDateString()
  dateFinExecution?: string | null;

  // ─── Objectifs globaux BSIC NIGER ───────────────────────────────

  @ApiPropertyOptional({
    example: '14500.00',
    description: 'PNB consolidé cible en M FCFA',
  })
  @IsOptional()
  @IsNumberString()
  pnbConsolideMfcfa?: string | null;

  @ApiPropertyOptional({
    example: '1200.00',
    description: 'RN consolidé cible en M FCFA',
  })
  @IsOptional()
  @IsNumberString()
  rnConsolideMfcfa?: string | null;

  @ApiPropertyOptional({
    example: '13.00',
    description: 'Croissance crédits globale %',
  })
  @IsOptional()
  @IsNumberString()
  croissanceCreditsGlobalePct?: string | null;

  @ApiPropertyOptional({
    example: '10.00',
    description: 'Croissance dépôts globale %',
  })
  @IsOptional()
  @IsNumberString()
  croissanceDepotsGlobalePct?: string | null;

  // ─── Indicateurs de mobilisation ────────────────────────────────

  @ApiPropertyOptional({
    example: '95.00',
    description: 'Taux de participation visé des directions %',
  })
  @IsOptional()
  @IsNumberString()
  tauxParticipationVisePct?: string | null;

  @ApiPropertyOptional({
    example: 12,
    description: "Nombre d'objectifs prioritaires identifiés",
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  nbObjectifsPrioritaires?: number | null;

  @ApiPropertyOptional({
    example: '98.00',
    description: 'Taux de conformité budgétaire visé %',
  })
  @IsOptional()
  @IsNumberString()
  tauxConformiteBudgetairePct?: string | null;

  // ─── Échéances clés (5 jalons) ──────────────────────────────────

  @ApiPropertyOptional({ example: '2027-12-20', format: 'date' })
  @IsOptional()
  @IsDateString()
  dateReunionMobilisation?: string | null;

  @ApiPropertyOptional({ example: '2028-01-15', format: 'date' })
  @IsOptional()
  @IsDateString()
  dateDebutSaisieObjectifs?: string | null;

  @ApiPropertyOptional({ example: '2028-03-31', format: 'date' })
  @IsOptional()
  @IsDateString()
  datePremierPointAvancement?: string | null;

  @ApiPropertyOptional({ example: '2028-06-30', format: 'date' })
  @IsOptional()
  @IsDateString()
  dateValidationFinale?: string | null;

  @ApiPropertyOptional({ example: '2028-07-31', format: 'date' })
  @IsOptional()
  @IsDateString()
  dateCommunicationBceao?: string | null;

  // ─── Message DG (HTML TipTap) ───────────────────────────────────

  @ApiPropertyOptional({
    example:
      '<h2>Chers collègues</h2><p>Cette année marque un tournant <strong>décisif</strong>…</p>',
    description:
      'HTML riche généré par éditeur TipTap (frontend). TipTap émet ' +
      "un HTML sécurisé par défaut (pas de <script>, pas d'on*).",
  })
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  messageDgHtml?: string | null;

  // ─── Engagement attendu ─────────────────────────────────────────

  @ApiPropertyOptional({
    example:
      "Chaque Directeur s'engage à respecter le calendrier et à atteindre les indicateurs.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  engagementAttendu?: string | null;
}
