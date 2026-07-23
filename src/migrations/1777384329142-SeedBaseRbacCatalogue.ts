import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Catalogue RBAC de base (permissions socle + rôles ADMIN / LECTEUR).
 *
 * CORRECTIF ARCHITECTURAL : ce catalogue était historiquement créé par
 * le SEED (`auth-seed.ts`), pas par une migration. Résultat : sur une
 * base reconstruite uniquement à partir des migrations (Heroku, reprise
 * après sinistre, CI), les migrations ultérieures qui référencent le
 * rôle ADMIN ou les permissions socle (110, 400, …) échouaient
 * (« Rôle ADMIN introuvable », NOT NULL fk_permission). Le catalogue
 * RBAC est une donnée SYSTÈME : il appartient aux migrations. Le seed
 * ne conserve que la création des UTILISATEURS de démo (admin/lecteur).
 *
 * Placé juste après `InitAuthSchema1777384329141` (qui crée les tables
 * ref_permission / ref_role / bridge_role_permission), donc AVANT toute
 * migration qui référence ADMIN ou une permission socle.
 *
 * Entièrement idempotent (`ON CONFLICT DO NOTHING`) : sans effet sur les
 * bases existantes déjà seedées, où le catalogue est déjà présent.
 *
 * Valeurs strictement alignées sur `auth-seed.ts` (PERMISSIONS + ROLES).
 */
interface PermRow {
  code: string;
  libelle: string;
  module: string;
  description: string | null;
}

const PERMISSIONS: PermRow[] = [
  {
    code: 'SYSTEM.ADMIN',
    libelle: 'Administration système',
    module: 'SYSTEM',
    description: "Accès complet à toutes les fonctionnalités d'administration.",
  },
  {
    code: 'USER.LIRE',
    libelle: 'Lire les utilisateurs',
    module: 'USER',
    description: null,
  },
  {
    code: 'USER.GERER',
    libelle: 'Gérer les utilisateurs',
    module: 'USER',
    description: 'Créer, modifier, désactiver des utilisateurs.',
  },
  {
    code: 'ROLE.LIRE',
    libelle: 'Lire les rôles et permissions',
    module: 'ROLE',
    description: null,
  },
  {
    code: 'ROLE.GERER',
    libelle: 'Gérer les rôles et permissions',
    module: 'ROLE',
    description:
      'Créer, modifier, supprimer des rôles ; affecter des permissions.',
  },
  {
    code: 'AUDIT.LIRE',
    libelle: "Consulter le journal d'audit",
    module: 'AUDIT',
    description: null,
  },
  {
    code: 'REFERENTIEL.LIRE',
    libelle: 'Lire les référentiels',
    module: 'REFERENTIEL',
    description: null,
  },
  {
    code: 'REFERENTIEL.GERER',
    libelle: 'Gérer les référentiels',
    module: 'REFERENTIEL',
    description:
      'Créer, modifier, désactiver les éléments des référentiels (devises, calendrier, etc.).',
  },
  {
    code: 'BUDGET.LIRE',
    libelle: 'Lire les faits budget',
    module: 'BUDGET',
    description:
      'Consulter les lignes de fait_budget (toutes versions et scénarios).',
  },
  {
    code: 'BUDGET.SAISIR',
    libelle: 'Saisir / modifier les faits budget',
    module: 'BUDGET',
    description:
      "Créer et modifier les mesures d'un fait_budget tant que la version est ouverte.",
  },
  {
    code: 'BUDGET.SUPPRIMER',
    libelle: 'Supprimer les faits budget',
    module: 'BUDGET',
    description:
      'Supprimer une ligne de fait_budget (autorisé uniquement si la version est ouverte).',
  },
  {
    code: 'BUDGET.SOUMETTRE',
    libelle: 'Soumettre une version pour contrôle',
    module: 'BUDGET',
    description:
      "Soumettre une version 'ouvert' à validation hiérarchique (transition ouvert → soumis).",
  },
  {
    code: 'BUDGET.VALIDER',
    libelle: 'Valider ou rejeter une version soumise',
    module: 'BUDGET',
    description:
      "Valider une version 'soumis' (soumis → valide) ou la rejeter (soumis → ouvert).",
  },
  {
    code: 'BUDGET.PUBLIER',
    libelle: 'Geler/publier une version validée',
    module: 'BUDGET',
    description:
      "Geler une version 'valide' (valide → gele). Action irréversible.",
  },
  {
    code: 'CONFIGURATION.LIRE',
    libelle: 'Lire la configuration (référentiels secondaires)',
    module: 'CONFIGURATION',
    description:
      'Consulter les énumérations métier (types structure / pays / classes compte / etc.).',
  },
  {
    code: 'CONFIGURATION.GERER',
    libelle: 'Gérer la configuration (référentiels secondaires)',
    module: 'CONFIGURATION',
    description:
      'Créer, modifier, désactiver, supprimer les valeurs des référentiels secondaires.',
  },
];

export class SeedBaseRbacCatalogue1777384329142 implements MigrationInterface {
  name = 'SeedBaseRbacCatalogue1777384329142';

  public async up(q: QueryRunner): Promise<void> {
    // 1. Permissions socle (idempotent).
    for (const p of PERMISSIONS) {
      await q.query(
        `INSERT INTO "ref_permission" ("code_permission", "libelle", "module", "description", "utilisateur_creation")
         VALUES ($1, $2, $3, $4, 'system')
         ON CONFLICT ("code_permission") DO NOTHING`,
        [p.code, p.libelle, p.module, p.description],
      );
    }

    // 2. Rôles ADMIN + LECTEUR (idempotent).
    await q.query(
      `INSERT INTO "ref_role" ("code_role", "libelle", "description", "est_actif", "utilisateur_creation")
       VALUES ('ADMIN', 'Administrateur système', 'Rôle disposant de toutes les permissions techniques.', true, 'system')
       ON CONFLICT ("code_role") DO NOTHING`,
    );
    await q.query(
      `INSERT INTO "ref_role" ("code_role", "libelle", "description", "est_actif", "utilisateur_creation")
       VALUES ('LECTEUR', 'Lecteur', 'Rôle en lecture seule sur les utilisateurs, rôles et journal d''audit.', true, 'system')
       ON CONFLICT ("code_role") DO NOTHING`,
    );

    // 3. Bridges rôle↔permission. ADMIN = toutes les permissions socle ;
    //    LECTEUR = les permissions se terminant par « .LIRE ». JOIN
    //    tolérant + ON CONFLICT → aucune insertion NULL, idempotent.
    await q.query(
      `INSERT INTO "bridge_role_permission" ("fk_role", "fk_permission")
       SELECT r."id", p."id"
         FROM "ref_role" r CROSS JOIN "ref_permission" p
        WHERE r."code_role" = 'ADMIN'
       ON CONFLICT ON CONSTRAINT "uq_bridge_role_permission" DO NOTHING`,
    );
    await q.query(
      `INSERT INTO "bridge_role_permission" ("fk_role", "fk_permission")
       SELECT r."id", p."id"
         FROM "ref_role" r CROSS JOIN "ref_permission" p
        WHERE r."code_role" = 'LECTEUR'
          AND p."code_permission" LIKE '%.LIRE'
       ON CONFLICT ON CONSTRAINT "uq_bridge_role_permission" DO NOTHING`,
    );
  }

  public async down(): Promise<void> {
    // No-op : catalogue RBAC système, non destructible par un revert
    // (les migrations suivantes en dépendent). Rollback via drop schema.
  }
}
