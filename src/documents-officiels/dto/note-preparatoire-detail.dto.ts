/**
 * DTO d'upsert du détail métier d'une Note préparatoire DG
 * (Lot 8.3.C).
 *
 * Pattern strictement aligné Lots 8.2.C / 8.3.A / 8.3.B. Tous les
 * champs sont optionnels (draft incomplet autorisé en BROUILLON).
 * Validation stricte du format au niveau DTO + 2ème couche CHECK
 * SQL côté DB (défense en profondeur).
 *
 * `ordreDuJourHtml` : HTML généré par TipTap côté frontend. TipTap
 * émet du HTML sécurisé par défaut (whitelist d'éléments, pas de
 * `<script>` ni d'attributs `on*`). Max 10 000 chars pour limiter
 * l'abus.
 *
 * **Cohérence dates de préparation** : `dateDebutPreparation` <=
 * `dateButoirPreparation` est garanti côté DB par le CHECK
 * `ck_dates_preparation_coherentes` (premier CHECK relationnel
 * cross-fields du projet). Pas de validation duplicée ici — la DB
 * est l'autorité finale et le client reçoit 500 si violation.
 */
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreerOuMettreAJourNotePreparatoireDetailDto {
  // ─── En-tête note préparatoire ──────────────────────────────────

  @ApiPropertyOptional({ example: 'DG/BSIC-NIGER/2028/PREP-01' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  referenceNote?: string | null;

  @ApiPropertyOptional({ example: '2027-11-15', format: 'date' })
  @IsOptional()
  @IsDateString()
  dateEmission?: string | null;

  @ApiPropertyOptional({ example: '2027-12-05', format: 'date' })
  @IsOptional()
  @IsDateString()
  dateConvocationComite?: string | null;

  @ApiPropertyOptional({ example: 'Salle CODIR — Siège BSIC NIGER' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  lieuReunion?: string | null;

  // ─── Participants convoqués ─────────────────────────────────────

  @ApiPropertyOptional({
    example:
      'M. Issoufou BARRY (DG)\nMme Halima OUSMANE (DGA Opérations)\n' +
      'M. Ibrahima MAHAMADOU (DGA Développement)\nM. Ousmane MAMANE (Coordinateur Finance)',
    description: 'Liste textuelle multi-lignes (un participant par ligne)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  participantsConvoques?: string | null;

  // ─── Exercice budgétaire concerné ───────────────────────────────

  @ApiPropertyOptional({ example: 2028, minimum: 2020, maximum: 2050 })
  @IsOptional()
  @IsInt()
  @Min(2020)
  @Max(2050)
  exerciceConcerne?: number | null;

  @ApiPropertyOptional({ example: '2027-12-15', format: 'date' })
  @IsOptional()
  @IsDateString()
  dateDebutPreparation?: string | null;

  @ApiPropertyOptional({ example: '2028-01-31', format: 'date' })
  @IsOptional()
  @IsDateString()
  dateButoirPreparation?: string | null;

  // ─── Ordre du jour (HTML TipTap) ────────────────────────────────

  @ApiPropertyOptional({
    example:
      '<ol><li>Ouverture de séance (10 min)</li><li>Contexte macro UEMOA (20 min)</li><li>Orientations stratégiques (45 min)</li></ol>',
    description:
      'HTML riche généré par éditeur TipTap (frontend) : points, ' +
      'sous-points, durées estimées. TipTap émet un HTML sécurisé ' +
      "par défaut (pas de <script>, pas d'on*).",
  })
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  ordreDuJourHtml?: string | null;

  // ─── Documents pré-lus attendus ─────────────────────────────────

  @ApiPropertyOptional({
    example:
      "Rapport d'activité S1 2027\nNote macro UEMOA novembre 2027\n" +
      'Tableau de bord stratégique Q3 2027',
    description: 'Liste textuelle multi-lignes des documents attendus',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  documentsPreLus?: string | null;

  // ─── Points clés à débattre ─────────────────────────────────────

  @ApiPropertyOptional({
    example:
      'Priorités investissement IT 2028 — Politique de provisionnement créances douteuses — Plan de mobilisation dépôts CHR.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  pointsClesDebattre?: string | null;

  // ─── Décisions attendues ────────────────────────────────────────

  @ApiPropertyOptional({
    example:
      "Validation des axes stratégiques 2028 — Cadrage chiffré du PNB cible — Calendrier d'exécution.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  decisionsAttendues?: string | null;
}
