/**
 * DTO d'upsert du détail métier d'une Lettre d'officialisation
 * (Lot 8.3.E).
 *
 * Pattern strictement aligné Lots 8.2.C / 8.3.A / 8.3.B / 8.3.C / 8.3.D.
 * Tous les champs sont optionnels (draft incomplet autorisé en
 * BROUILLON). Validation stricte du format au niveau DTO + 2ème
 * couche CHECK SQL côté DB (défense en profondeur).
 *
 * **Particularités D12** :
 *  - `cachetAppose` : 2e BOOLEAN des détails métier riches (après
 *    `quorumAtteint` D11) — drapeau workflow cachet physique
 *  - `corpsHtml` : 1 seule colonne TipTap (vs 2 pour D11)
 *  - `referencePvCa` : texte libre, AUCUN format imposé (Option A —
 *    pas de regex, pas de FK)
 *
 * **Cohérence dates** : `dateEntreeVigueur >= dateEmission` est
 * garanti côté DB par le CHECK `ck_dates_lo_coherentes` (3e CHECK
 * relationnel cross-fields du projet, après `ck_dates_preparation_coherentes`
 * D1 et `ck_quorum_coherent_pv` D11). Pas de validation duplicée
 * ici — la DB est l'autorité finale.
 */
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreerOuMettreAJourLettreOfficialisationDetailDto {
  // ─── Identification de la lettre ────────────────────────────────

  @ApiPropertyOptional({ example: 'LOFF-BSIC-2027-001' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  numeroLettre?: string | null;

  @ApiPropertyOptional({ example: '2027-12-22', format: 'date' })
  @IsOptional()
  @IsDateString()
  dateEmission?: string | null;

  @ApiPropertyOptional({
    example: 'Officialisation du budget 2028 approuvé par le CA',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  objet?: string | null;

  // ─── Référence PV CA (texte libre) ──────────────────────────────

  @ApiPropertyOptional({
    example: 'CA-BSIC-2027-007',
    description:
      'Référence libre vers le PV CA approuvant le budget. Pas de format ' +
      'imposé (Option A actée) — peut référencer un PV externe filiale, ' +
      'un PV non encore créé en base, ou plusieurs PV via texte libre.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  referencePvCa?: string | null;

  // ─── Destinataires ──────────────────────────────────────────────

  @ApiPropertyOptional({
    example:
      'Direction Réseau\nDirection Crédits\nDirection Conformité\n' +
      'Direction Risques\nDirection RH\nDirection IT\nDirection Audit',
    description: 'Liste textuelle multi-lignes (un destinataire par ligne)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  destinatairesPrincipaux?: string | null;

  @ApiPropertyOptional({
    example:
      'BCEAO Niamey\nCREPMF\nHolding BSIC Tripoli\nCommissariat aux comptes',
    description: 'Destinataires en copie (BCEAO, holding, etc.)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  destinatairesCopies?: string | null;

  @ApiPropertyOptional({
    example:
      'PV CA n°007 du 18/12/2027\nLettre de cadrage 2028\nNote orientation Comité',
    description: 'Liste des pièces jointes à la lettre',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  piecesJointes?: string | null;

  // ─── Corps de la lettre (HTML TipTap) ───────────────────────────

  @ApiPropertyOptional({
    example:
      "<p>Mesdames et Messieurs les Directeurs,</p><p>Suite à la réunion du Conseil d'Administration du 18/12/2027, nous avons le plaisir de vous notifier l'approbation officielle du budget 2028…</p>",
    description:
      'HTML riche généré par éditeur TipTap (frontend). TipTap émet ' +
      "un HTML sécurisé par défaut (pas de <script>, pas d'on*).",
  })
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  corpsHtml?: string | null;

  // ─── Signature & officialisation ────────────────────────────────

  @ApiPropertyOptional({ example: 'M. Issoufou BARRY (Directeur Général)' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  signataire?: string | null;

  @ApiPropertyOptional({ example: '2028-01-01', format: 'date' })
  @IsOptional()
  @IsDateString()
  dateEntreeVigueur?: string | null;

  @ApiPropertyOptional({
    example: true,
    description: 'Drapeau cachet physique apposé après signature électronique',
  })
  @IsOptional()
  @IsBoolean()
  cachetAppose?: boolean | null;
}
