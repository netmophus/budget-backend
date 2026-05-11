/**
 * DTOs de l'import budgétaire en masse (Lot 3.7).
 *
 * Format de fichier (CSV ou XLSX, 9 colonnes fixes) :
 *  1. code_cr             string  ex: 'CR_AG_ABJ_PLATEAU'
 *  2. code_compte         string  ex: '611100'
 *  3. code_ligne_metier   string  ex: 'RETAIL_PARTICULIERS'
 *  4. mois                date    'YYYY-MM-01' ou 'YYYY-MM-DD'
 *  5. mode_saisie         enum    'MONTANT' | 'ENCOURS_TIE'
 *  6. montant             decimal point séparateur
 *  7. encours_moyen       decimal vide si MONTANT
 *  8. tie                 decimal entre 0 et 1, vide si MONTANT
 *  9. commentaire         string  optionnel, max 2000 chars
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString } from 'class-validator';

/** Codes d'erreur ligne par ligne — typés pour faciliter la lecture côté UI. */
export type ImportBudgetErrorCode =
  | 'VALIDATION_FORMAT' // colonne manquante / type invalide
  | 'CR_INTROUVABLE'
  | 'CR_PERIMETRE_REFUSE'
  | 'COMPTE_INTROUVABLE'
  | 'COMPTE_AGREGE' // est_compte_collectif=true
  | 'LIGNE_METIER_INTROUVABLE'
  | 'TEMPS_INTROUVABLE' // dim_temps absent pour ce mois
  | 'TEMPS_PAS_PREMIER_DU_MOIS'
  | 'MODE_SAISIE_INVALIDE'
  | 'ENCOURS_TIE_CHAMPS_MANQUANTS'
  | 'TIE_HORS_BORNES'
  | 'AUTRE';

export type ImportBudgetWarningCode =
  | 'MONTANT_RECALCULE' // mode ENCOURS_TIE : montant = encours × tie / 12
  | 'COMMENTAIRE_TRONQUE';

export class ImportBudgetErrorDto {
  @ApiProperty({
    example: 12,
    description: 'Numéro de ligne dans le fichier (1=header).',
  })
  ligneNumero!: number;

  @ApiProperty({ example: 'CR_INTROUVABLE' })
  code!: ImportBudgetErrorCode;

  @ApiProperty()
  message!: string;

  @ApiPropertyOptional({
    description:
      "Valeur fournie qui a déclenché l'erreur (utile pour le diagnostic UI).",
  })
  valeurFournie?: string;
}

export class ImportBudgetWarningDto {
  @ApiProperty()
  ligneNumero!: number;

  @ApiProperty({ example: 'MONTANT_RECALCULE' })
  code!: ImportBudgetWarningCode;

  @ApiProperty()
  message!: string;
}

export class ImportBudgetRapportDto {
  @ApiProperty({ example: 'budget-2027.csv' })
  fichier!: string;

  @ApiProperty({ example: 12 })
  tailleKo!: number;

  @ApiProperty({ enum: ['csv', 'xlsx'] })
  formatDetecte!: 'csv' | 'xlsx';

  @ApiProperty({ description: 'Lignes de données (hors header).' })
  lignesTotal!: number;

  @ApiProperty({ description: 'Lignes ayant passé toutes les validations.' })
  lignesValides!: number;

  @ApiProperty({ description: 'Lignes nouvellement insérées.' })
  lignesInserees!: number;

  @ApiProperty({ description: 'Lignes mises à jour (déjà existantes).' })
  lignesModifiees!: number;

  @ApiProperty({
    description:
      "Lignes valides mais identiques à l'existant (no-op, pas de bruit historique).",
  })
  lignesIgnorees!: number;

  @ApiProperty({ description: 'Lignes en erreur (cf. tableau erreurs).' })
  lignesRejetees!: number;

  @ApiProperty({ type: [ImportBudgetErrorDto] })
  erreurs!: ImportBudgetErrorDto[];

  @ApiProperty({ type: [ImportBudgetWarningDto] })
  warnings!: ImportBudgetWarningDto[];

  @ApiProperty({ example: 1234 })
  dureeMs!: number;

  @ApiProperty({
    description:
      'true si plus de 10% des lignes étaient en erreur — la transaction a été annulée.',
  })
  transactionRollback!: boolean;
}

/** Body multipart (le fichier est passé via FileInterceptor). */
export class ImportBudgetRequestDto {
  @ApiProperty({
    description: 'Id de la version cible (statut=ouvert obligatoire).',
  })
  @IsString()
  versionId!: string;

  @ApiProperty({ description: 'Id du scénario cible.' })
  @IsString()
  scenarioId!: string;
}
