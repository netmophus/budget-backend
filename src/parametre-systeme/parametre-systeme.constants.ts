/**
 * Constantes du paramétrage système (table `parametre_systeme`).
 *
 * Palier 1 — gouvernance de la saisie du réalisé : un toggle global
 * `mode_saisie_realise` arbitre entre saisie décentralisée (saisisseurs
 * CR), centralisée (Direction Finance par import) ou les deux.
 */

/** Clé du paramètre de mode de saisie du réalisé. */
export const CLE_MODE_SAISIE_REALISE = 'mode_saisie_realise';

/**
 * Modes de saisie du réalisé :
 *  - CENTRALISE   : seul l'import (Direction Finance) alimente le réalisé ;
 *                   la saisie manuelle (POST /realise) est désactivée.
 *  - DECENTRALISE : les saisisseurs saisissent le réalisé de leur CR.
 *  - MIXTE        : saisie manuelle ET import autorisés simultanément.
 */
export type ModeSaisieRealise = 'CENTRALISE' | 'DECENTRALISE' | 'MIXTE';

export const MODES_SAISIE_REALISE: readonly ModeSaisieRealise[] = [
  'CENTRALISE',
  'DECENTRALISE',
  'MIXTE',
];

/** Valeur par défaut (cohérente avec le seed de migration 570). */
export const MODE_SAISIE_REALISE_DEFAUT: ModeSaisieRealise = 'CENTRALISE';
