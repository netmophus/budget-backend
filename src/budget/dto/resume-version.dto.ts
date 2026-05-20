import { ApiProperty } from '@nestjs/swagger';

/**
 * Réponse de `GET /api/v1/budget/versions/:id/resume` (Lot 7.3).
 *
 * Agrège `fait_budget` pour la version cible, filtrée par périmètre RBAC
 * de l'utilisateur connecté (cf. PerimetreService.getCrAutorisesPourUser).
 *
 * Utilisé par la page « Versions à valider » pour afficher en tête de
 * carte le montant total saisi + le nombre de comptes couverts. Aide
 * le validateur à apprécier le poids de la soumission sans avoir à
 * ouvrir la grille de saisie.
 */
export class ResumeVersionDto {
  @ApiProperty({
    description: 'Identifiant de la version (bigint stringifié).',
    example: '1',
  })
  versionId!: string;

  @ApiProperty({
    description:
      'Somme des `montant_fcfa` des `fait_budget` pour la version, ' +
      'restreinte aux CR du périmètre du user (0 si périmètre vide).',
    example: 30_000_000,
  })
  montantTotalFcfa!: number;

  @ApiProperty({
    description:
      'Nombre de comptes feuilles distincts ayant au moins une ligne ' +
      'budget pour la version (filtre périmètre appliqué).',
    example: 5,
  })
  nombreComptes!: number;

  @ApiProperty({
    description:
      'Nombre de lignes `fait_budget` au total pour la version ' +
      '(filtre périmètre appliqué). Utile pour distinguer une version ' +
      "détaillée 12 mois × N comptes d'une version partiellement saisie.",
    example: 60,
  })
  nombreLignes!: number;
}
