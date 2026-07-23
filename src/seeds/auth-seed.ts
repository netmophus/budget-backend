/**
 * Seed des utilisateurs initiaux du projet.
 *
 * Les mots de passe par défaut DEFAULT_ADMIN_PASSWORD et
 * DEFAULT_LECTEUR_PASSWORD sont VOLONTAIREMENT PUBLICS :
 *   - documentés dans .env.example (versionné)
 *   - documentés dans README §Comptes de démo
 *   - utilisés en fallback si SEED_ADMIN_PASSWORD /
 *     SEED_LECTEUR_PASSWORD ne sont pas définis dans l'environnement
 *
 * Cette publicité est acceptable en dev/test où ces comptes
 * sont éphémères. En production, le fallback est INTERDIT :
 * le seed jette une erreur si NODE_ENV=production et la variable
 * d'env correspondante n'est pas explicitement définie
 * (cf. `assertProductionPasswordPolicy`).
 *
 * Référence : ADR à ajouter dans architecture.md §12 — TODO Lot 6.
 */
import 'reflect-metadata';
import * as bcrypt from 'bcrypt';
import type { DataSource } from 'typeorm';
import { AppDataSource } from '../data-source';

const ADMIN_EMAIL = 'admin@miznas.local';
const ADMIN_NOM = 'Admin';
const ADMIN_PRENOM = 'MIZNAS';
const DEFAULT_ADMIN_PASSWORD = 'ChangeMe!2026';

const LECTEUR_EMAIL = 'lecteur@miznas.local';
const LECTEUR_NOM = 'Lecteur';
const LECTEUR_PRENOM = 'Test';
const DEFAULT_LECTEUR_PASSWORD = 'Lecteur!2026';

const RED = '\x1b[31m';
const RESET = '\x1b[0m';

interface SeedUser {
  email: string;
  nom: string;
  prenom: string;
  passwordEnvVar: string;
  defaultPassword: string;
  roleCode: string;
}

const SEED_USERS: SeedUser[] = [
  {
    email: ADMIN_EMAIL,
    nom: ADMIN_NOM,
    prenom: ADMIN_PRENOM,
    passwordEnvVar: 'SEED_ADMIN_PASSWORD',
    defaultPassword: DEFAULT_ADMIN_PASSWORD,
    roleCode: 'ADMIN',
  },
  {
    email: LECTEUR_EMAIL,
    nom: LECTEUR_NOM,
    prenom: LECTEUR_PRENOM,
    passwordEnvVar: 'SEED_LECTEUR_PASSWORD',
    defaultPassword: DEFAULT_LECTEUR_PASSWORD,
    roleCode: 'LECTEUR',
  },
];

/**
 * Garde-fou production. Refuse de continuer si NODE_ENV=production
 * et que la variable d'environnement portant le mot de passe du
 * compte initial n'est pas explicitement définie — ce qui ferait
 * sinon utiliser le fallback `DEFAULT_*_PASSWORD` (public).
 *
 * Exporté pour test isolé dans `auth-seed.spec.ts`.
 */
export function assertProductionPasswordPolicy(envVarName: string): void {
  if (process.env.NODE_ENV === 'production' && !process.env[envVarName]) {
    throw new Error(
      `${envVarName} doit être défini en production. ` +
        `Le mot de passe par défaut est public (cf. .env.example) ` +
        `et inacceptable en prod.`,
    );
  }
}

export async function seedAuth(ds: DataSource = AppDataSource): Promise<void> {
  const ownsConnection = !ds.isInitialized;
  if (ownsConnection) {
    await ds.initialize();
  }

  try {
    await ds.transaction(async (manager) => {
      // NB : le catalogue RBAC (permissions socle + rôles ADMIN/LECTEUR +
      // leurs bridges) N'EST PLUS créé ici — il l'est par la migration
      // 1777384329142-SeedBaseRbacCatalogue, source unique. Ce seed ne
      // crée plus que les UTILISATEURS de démo (donnée non-système). Les
      // rôles ADMIN/LECTEUR référencés ci-dessous préexistent donc via la
      // migration (ou, en e2e, via la phase 1 exécutée avant ce seed).

      // Utilisateurs par défaut (idempotents) + assignation de leur rôle global
      const rounds = Number.parseInt(process.env.BCRYPT_ROUNDS ?? '12', 10);

      for (const seedUser of SEED_USERS) {
        assertProductionPasswordPolicy(seedUser.passwordEnvVar);
        const passwordPlain =
          process.env[seedUser.passwordEnvVar] ?? seedUser.defaultPassword;
        if (passwordPlain === seedUser.defaultPassword) {
          console.warn(
            `${RED}[seed:auth] WARNING: ${seedUser.passwordEnvVar} non défini. Mot de passe par défaut "${seedUser.defaultPassword}" pour ${seedUser.email}. À CHANGER avant tout usage non-test.${RESET}`,
          );
        }

        const existing = (await manager.query(
          `SELECT id FROM "user" WHERE email = $1`,
          [seedUser.email],
        )) as Array<{ id: string }>;

        if (existing.length === 0) {
          const passwordHash = await bcrypt.hash(passwordPlain, rounds);
          await manager.query(
            `INSERT INTO "user" (email, mot_de_passe_hash, nom, prenom, est_actif, utilisateur_creation)
             VALUES ($1, $2, $3, $4, true, 'system')`,
            [seedUser.email, passwordHash, seedUser.nom, seedUser.prenom],
          );
        }

        // Affectation du rôle global (idempotent : NOT EXISTS, car l'index
        // unique partiel uq_bridge_user_role_global n'est pas une CONSTRAINT
        // utilisable avec ON CONFLICT).
        await manager.query(
          `INSERT INTO bridge_user_role (fk_user, fk_role, perimetre_type, perimetre_id, est_actif, utilisateur_creation)
           SELECT u.id, r.id, 'global', NULL, true, 'system'
           FROM "user" u CROSS JOIN ref_role r
           WHERE u.email = $1 AND r.code_role = $2
             AND NOT EXISTS (
               SELECT 1 FROM bridge_user_role bur
               WHERE bur.fk_user = u.id AND bur.fk_role = r.id AND bur.perimetre_id IS NULL
             )`,
          [seedUser.email, seedUser.roleCode],
        );
      }

      // 6. Récap
      const stats = await manager.query(
        `SELECT
            (SELECT COUNT(*)::int FROM ref_permission) AS permissions,
            (SELECT COUNT(*)::int FROM ref_role) AS roles,
            (SELECT COUNT(*)::int FROM bridge_role_permission) AS role_permissions,
            (SELECT COUNT(*)::int FROM "user") AS users,
            (SELECT COUNT(*)::int FROM bridge_user_role) AS user_roles`,
      );
      const row = stats[0] as {
        permissions: number;
        roles: number;
        role_permissions: number;
        users: number;
        user_roles: number;
      };
      console.log(
        `[seed:auth] permissions=${row.permissions} roles=${row.roles} role_permissions=${row.role_permissions} users=${row.users} user_roles=${row.user_roles}`,
      );
    });
  } finally {
    if (ownsConnection) {
      await ds.destroy();
    }
  }
}

// Bootstrap réservé à l'exécution directe (`ts-node src/seeds/auth-seed.ts`
// via `npm run seed:auth`). Pas d'effet de bord à l'import — nécessaire
// pour que `auth-seed.spec.ts` puisse importer `assertProductionPasswordPolicy`
// sans déclencher l'init du DataSource.
if (require.main === module) {
  seedAuth()
    .then(() => {
      console.log('[seed:auth] Done.');
      process.exit(0);
    })
    .catch((err: unknown) => {
      console.error('[seed:auth] Failed:', err);
      process.exit(1);
    });
}
