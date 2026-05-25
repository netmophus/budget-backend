/**
 * DTO d'upsert du détail métier d'un PV d'approbation CA (Lot 8.3.D).
 *
 * Pattern strictement aligné Lots 8.2.C / 8.3.A / 8.3.B / 8.3.C.
 * Tous les champs sont optionnels (draft incomplet autorisé en
 * BROUILLON). Validation stricte du format au niveau DTO + 2ème
 * couche CHECK SQL côté DB (défense en profondeur).
 *
 * **Particularités D11** :
 *  - `quorumAtteint` : premier BOOLEAN des détails métier riches
 *  - `voteResultat` : enum textuelle 3 valeurs (UNANIMITE / MAJORITE /
 *    REJETE), validée par `@IsIn` côté DTO + CHECK SQL côté DB
 *  - 2 colonnes TipTap (`ordreDuJourHtml` + `decisionsHtml`) — premier
 *    détail métier riche avec 2 éditeurs riches simultanés
 *
 * **Cohérence quorum** : `nbAdministrateursPresents <=
 * nbAdministrateursTotal` est garanti côté DB par le CHECK
 * `ck_quorum_coherent_pv` (2e CHECK relationnel cross-fields du
 * projet, après `ck_dates_preparation_coherentes` du Lot 8.3.C).
 * Pas de validation duplicée ici — la DB est l'autorité finale.
 */
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export const VOTE_RESULTATS_VALIDES = [
  'UNANIMITE',
  'MAJORITE',
  'REJETE',
] as const;

export type VoteResultat = (typeof VOTE_RESULTATS_VALIDES)[number];

export class CreerOuMettreAJourPvApprobationDetailDto {
  // ─── Identification du PV ───────────────────────────────────────

  @ApiPropertyOptional({ example: 'CA-BSIC-2027-007' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  numeroResolution?: string | null;

  @ApiPropertyOptional({ example: '2027-12-18', format: 'date' })
  @IsOptional()
  @IsDateString()
  dateSeanceCa?: string | null;

  @ApiPropertyOptional({ example: 'Salle CA — Siège BSIC NIGER' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  lieuSeance?: string | null;

  // ─── Présidence ─────────────────────────────────────────────────

  @ApiPropertyOptional({ example: 'M. Boubacar HASSANE' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  presidentSeance?: string | null;

  @ApiPropertyOptional({ example: 'Mme Fatima ABDOU' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  secretaireSeance?: string | null;

  // ─── Quorum ─────────────────────────────────────────────────────

  @ApiPropertyOptional({
    example: 8,
    description: "Nombre d'administrateurs présents",
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  nbAdministrateursPresents?: number | null;

  @ApiPropertyOptional({
    example: 10,
    description: "Nombre total d'administrateurs au CA",
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  nbAdministrateursTotal?: number | null;

  @ApiPropertyOptional({
    example: true,
    description:
      'Drapeau quorum atteint (calculé manuellement par le secrétaire)',
  })
  @IsOptional()
  @IsBoolean()
  quorumAtteint?: boolean | null;

  // ─── Ordre du jour (HTML TipTap) ────────────────────────────────

  @ApiPropertyOptional({
    example:
      '<ol><li>Approbation du budget 2028</li><li>Questions diverses</li></ol>',
    description:
      'HTML riche généré par éditeur TipTap (frontend). TipTap émet ' +
      "un HTML sécurisé par défaut (pas de <script>, pas d'on*).",
  })
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  ordreDuJourHtml?: string | null;

  // ─── Décisions adoptées (HTML TipTap) ───────────────────────────

  @ApiPropertyOptional({
    example:
      '<h3>Résolution n°007</h3><p>Le CA <strong>approuve</strong> le budget 2028 cadré à 14 500 M FCFA…</p>',
    description:
      'HTML riche généré par éditeur TipTap. Contient le texte des ' +
      'résolutions adoptées par le Conseil.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  decisionsHtml?: string | null;

  // ─── Vote ───────────────────────────────────────────────────────

  @ApiPropertyOptional({
    enum: VOTE_RESULTATS_VALIDES,
    example: 'UNANIMITE',
    description: "Résultat du vote ('UNANIMITE' | 'MAJORITE' | 'REJETE')",
  })
  @IsOptional()
  @IsIn(VOTE_RESULTATS_VALIDES as readonly string[])
  voteResultat?: VoteResultat | null;

  @ApiPropertyOptional({
    example:
      'Le Président félicite la DG pour la qualité du dossier de cadrage présenté.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  commentairePresident?: string | null;
}
