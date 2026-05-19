import { ApiProperty } from '@nestjs/swagger';

/**
 * Réponse de `GET /api/v1/me/perimetre` (Lot 7.3).
 *
 * Résumé en un coup d'œil du périmètre RBAC effectif du user connecté :
 *  - `nbCrAccessibles` : nombre de CR ouverts à l'écriture/lecture
 *    selon ses rôles + affectations multi-périmètres (Lot 4.1).
 *  - `isAdminGlobal`   : true si au moins un rôle 'global' actif sans
 *    affectation explicite — alors `nbCrAccessibles` est égal au
 *    total des CR de l'organisation (calculé séparément côté front si
 *    besoin, l'UI affiche typiquement « Admin global » sans compteur).
 *
 * Utilisé par l'en-tête de la page « Versions à valider » (pill
 * "Mon périmètre (N CR)") et potentiellement par d'autres écrans
 * qui ont besoin de la même information.
 */
export class MePerimetreResumeDto {
  @ApiProperty({
    description:
      'Nombre de CR accessibles au user connecté. Si admin global, ' +
      "vaut le total des CR actifs de l'organisation. Toujours ≥ 0.",
    example: 12,
  })
  nbCrAccessibles!: number;

  @ApiProperty({
    description:
      "true si l'utilisateur a un rôle 'global' actif (sans affectation " +
      "explicite via user_perimetres). Permet à l'UI d'afficher " +
      '« Admin global » plutôt que le compteur.',
    example: false,
  })
  isAdminGlobal!: boolean;
}
