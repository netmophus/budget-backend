/**
 * Garde-fous de l'édition de la matrice rôle × permission (PR A —
 * gestion des rôles depuis l'UI admin, permission ROLE.GERER).
 *
 * Décisions tranchées (cf. brief PR A) :
 *  - PROTECTED_PERMISSIONS : permissions « racines » qui ne peuvent
 *    jamais être retirées du rôle ADMIN (séparation des tâches BCEAO :
 *    l'administration système doit toujours rester atteignable).
 *  - PROTECTED_ROLE : le seul rôle dont les permissions protégées sont
 *    verrouillées. Les autres rôles restent librement éditables.
 *
 * Anti-lockout (complémentaire, géré dans le service) : un utilisateur
 * ne peut pas retirer `ROLE.GERER` d'un rôle qu'il porte lui-même, sous
 * peine de se priver de l'accès à cet écran (et de geler la matrice).
 */
export const PROTECTED_PERMISSIONS: readonly string[] = [
  'SYSTEM.ADMIN',
  'ROLE.GERER',
  'USER.GERER',
];

/** Rôle dont les PROTECTED_PERMISSIONS ne peuvent être retirées. */
export const PROTECTED_ROLE = 'ADMIN';

/** Permission dont le retrait déclenche le garde-fou anti-lockout. */
export const ANTI_LOCKOUT_PERMISSION = 'ROLE.GERER';
