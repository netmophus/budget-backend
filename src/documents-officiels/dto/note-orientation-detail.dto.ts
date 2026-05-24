/**
 * DTO d'upsert du détail métier d'une Note d'orientation (Lot 8.3.A).
 *
 * Tous les champs sont optionnels (draft incomplet autorisé en
 * BROUILLON, pattern Lot 8.2.C). Validation strict du format au
 * niveau DTO + 2ème couche CHECK SQL côté DB (défense en profondeur).
 *
 * `descriptionDetailleeHtml` : HTML généré par TipTap côté frontend.
 * TipTap émet du HTML sécurisé par défaut (whitelist d'éléments,
 * pas de `<script>` ni d'attributs `on*`). Max 10 000 chars pour
 * limiter l'abus.
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

export class CreerOuMettreAJourNoteOrientationDetailDto {
  // ─── En-tête note interne ───────────────────────────────────────

  @ApiPropertyOptional({ example: 'DG/BSIC-NIGER/2027/ORIENT-01' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  numeroNote?: string | null;

  @ApiPropertyOptional({ example: '2026-06-15', format: 'date' })
  @IsOptional()
  @IsDateString()
  dateEmission?: string | null;

  @ApiPropertyOptional({ example: 'Direction Générale' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  emetteurDirection?: string | null;

  @ApiPropertyOptional({ example: 'Comité de Direction' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  destinataire?: string | null;

  // ─── Période d'application ──────────────────────────────────────

  @ApiPropertyOptional({ example: 2027, minimum: 2020, maximum: 2050 })
  @IsOptional()
  @IsInt()
  @Min(2020)
  @Max(2050)
  exerciceConcerne?: number | null;

  @ApiPropertyOptional({ example: '2027-01-01', format: 'date' })
  @IsOptional()
  @IsDateString()
  dateDebutApplication?: string | null;

  @ApiPropertyOptional({ example: '2027-12-31', format: 'date' })
  @IsOptional()
  @IsDateString()
  dateFinApplication?: string | null;

  // ─── Hypothèses macroéconomiques ────────────────────────────────

  @ApiPropertyOptional({
    example: '5.50',
    description: 'Taux directeur BCEAO %',
  })
  @IsOptional()
  @IsNumberString()
  tauxDirecteurBceaoPct?: string | null;

  @ApiPropertyOptional({ example: '3.20', description: 'Inflation Niger %' })
  @IsOptional()
  @IsNumberString()
  inflationNigerPct?: string | null;

  @ApiPropertyOptional({
    example: '6.80',
    description: 'Croissance PIB Niger %',
  })
  @IsOptional()
  @IsNumberString()
  croissancePibNigerPct?: string | null;

  @ApiPropertyOptional({
    example: '605.50',
    description: 'Taux change USD/FCFA',
  })
  @IsOptional()
  @IsNumberString()
  tauxChangeUsdFcfa?: string | null;

  @ApiPropertyOptional({
    example: '78.50',
    description: 'Cours pétrole USD/baril',
  })
  @IsOptional()
  @IsNumberString()
  coursPetroleUsd?: string | null;

  // ─── Positionnement marché ──────────────────────────────────────

  @ApiPropertyOptional({ example: '14.00' })
  @IsOptional()
  @IsNumberString()
  partMarcheActuellePct?: string | null;

  @ApiPropertyOptional({ example: '18.00' })
  @IsOptional()
  @IsNumberString()
  partMarcheCiblePct?: string | null;

  @ApiPropertyOptional({ example: 'Sonibank, Bank of Africa, Ecobank' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  principauxConcurrents?: string | null;

  @ApiPropertyOptional({
    example: "Réseau d'agences UEMOA, expertise PME locale",
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  avantagesCompetitifs?: string | null;

  // ─── Axes stratégiques prioritaires ─────────────────────────────

  @ApiPropertyOptional({ example: 'Renforcement du mobile banking…' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  axeDigitalisation?: string | null;

  @ApiPropertyOptional({ example: 'Doublement des encours PME…' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  axeDeveloppementPme?: string | null;

  @ApiPropertyOptional({ example: 'Ouverture de 5 nouvelles agences…' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  axeInclusionFinanciere?: string | null;

  @ApiPropertyOptional({ example: 'Formation continue des équipes…' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  axeAutresPriorites?: string | null;

  // ─── Description détaillée (HTML TipTap) ────────────────────────

  @ApiPropertyOptional({
    example: '<h2>Contexte</h2><p>Analyse <strong>détaillée</strong>…</p>',
    description:
      'HTML riche généré par éditeur TipTap (frontend). TipTap émet ' +
      "un HTML sécurisé par défaut (pas de <script>, pas d'on*).",
  })
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  descriptionDetailleeHtml?: string | null;

  // ─── Recommandations ────────────────────────────────────────────

  @ApiPropertyOptional({
    example: 'Soumettre à validation Comité avant 30/09/2026.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  recommandations?: string | null;
}
