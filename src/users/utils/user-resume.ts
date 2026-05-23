/**
 * Vue allégée d'un `User` pour exposition API (Lot 8.1.E — partagé).
 *
 * Pourquoi un helper partagé :
 *  - `campagne.service` et `document-workflow.service` ont besoin
 *    de retourner des relations User enrichies (signataire,
 *    émetteur, viseur) dans leurs réponses détaillées.
 *  - Le mapping doit être identique partout pour ne pas créer
 *    d'incohérences (un endpoint qui renvoie `dateDerniereConnexion`,
 *    un autre qui ne le fait pas).
 *
 * Défense en profondeur :
 *  - Couche 1 (Lot 8.1.E Palier 1) : `@Exclude({ toPlainOnly: true })`
 *    sur `User.motDePasseHash` + `ClassSerializerInterceptor` global
 *    → toute fuite hash automatiquement bloquée.
 *  - Couche 2 (ce helper) : sélection EXPLICITE des 4 champs utiles
 *    (id/email/nom/prenom) → minimise la surface API, ne fuite
 *    JAMAIS un champ ajouté plus tard à l'entité User (ex: si on
 *    ajoute `dateExpirationMdp` à la table, ce helper ne change pas).
 *
 * Avant Lot 8.1.E, ce mapping était dupliqué localement dans
 * `campagne.service.ts` (hotfix Lot 8.2.A). Extraction ici lors du
 * Palier 2 du Lot 8.1.E quand `document-workflow.service` en a eu
 * besoin pour son propre hotfix `detailDocument`/`listerDocuments`.
 */
import type { User } from '../entities/user.entity';

export interface UserResume {
  id: string;
  email: string;
  nom: string;
  prenom: string;
}

export function toUserResume(
  u: User | null | undefined,
): UserResume | undefined {
  if (!u) return undefined;
  return { id: u.id, email: u.email, nom: u.nom, prenom: u.prenom };
}
