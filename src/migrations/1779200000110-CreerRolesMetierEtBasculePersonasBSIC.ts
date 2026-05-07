import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lot 4.1-fix3 — Création des 4 rôles métier différenciés
 * (SAISISSEUR / VALIDATEUR / PUBLICATEUR / AUDITEUR), câblage de
 * leurs permissions et bascule des 6 personas BSIC sur ces rôles.
 *
 * Décisions actées (cf. rapport Phase 1) :
 *
 *   Rôle        | Permissions (perms existantes — aucune création)
 *   ------------|--------------------------------------------------
 *   SAISISSEUR  | BUDGET.LIRE, BUDGET.SAISIR, BUDGET.SOUMETTRE,
 *               | REFERENTIEL.LIRE, CONFIGURATION.LIRE          (5)
 *   VALIDATEUR  | BUDGET.LIRE, BUDGET.VALIDER, REFERENTIEL.LIRE,
 *               | CONFIGURATION.LIRE, USER.LIRE, AUDIT.LIRE     (6)
 *   PUBLICATEUR | BUDGET.LIRE, BUDGET.PUBLIER, REFERENTIEL.LIRE,
 *               | CONFIGURATION.LIRE, USER.LIRE, AUDIT.LIRE     (6)
 *   AUDITEUR    | AUDIT.LIRE, BUDGET.LIRE, REFERENTIEL.LIRE,
 *               | CONFIGURATION.LIRE, USER.LIRE, ROLE.LIRE      (6)
 *
 *   Persona                            | Nouveau rôle
 *   -----------------------------------|--------------
 *   dir.retail@miznas.local            | VALIDATEUR
 *   adj.retail@miznas.local            | SAISISSEUR
 *   dir.corporate@miznas.local         | VALIDATEUR
 *   controleur.gestion@miznas.local    | VALIDATEUR
 *   auditeur@miznas.local              | AUDITEUR
 *   dga.exploitation@miznas.local      | PUBLICATEUR
 *
 * `admin@miznas.local` (rôle ADMIN) et `lecteur@miznas.local`
 * (rôle LECTEUR) NE sont PAS touchés.
 *
 * Idempotence :
 *  - Section 1 (rôles) : `ON CONFLICT (code_role) DO NOTHING`
 *  - Section 2 (bridge_role_permission) : pas d'index UNIQUE en base
 *    → `INSERT … SELECT … WHERE NOT EXISTS` cible-par-cible
 *  - Section 3 (bascule) :
 *      a. UPDATE des bridges actifs des personas → est_actif=false
 *         (idempotent par construction : si déjà inactif, no-op)
 *      b. INSERT du nouveau rôle métier via NOT EXISTS sur
 *         (fk_user, fk_role, est_actif=true)
 *
 * Atomicité : TypeORM exécute la migration dans une transaction
 * implicite — si une étape échoue, tout est rollback.
 */
const ROLES_DEFINITIONS: Array<{
  code: string;
  libelle: string;
  description: string;
  permissions: string[];
}> = [
  {
    code: 'SAISISSEUR',
    libelle: 'Saisisseur de budget',
    description:
      'Saisit les lignes budgétaires de son périmètre et les soumet pour validation.',
    permissions: [
      'BUDGET.LIRE',
      'BUDGET.SAISIR',
      'BUDGET.SOUMETTRE',
      'REFERENTIEL.LIRE',
      'CONFIGURATION.LIRE',
    ],
  },
  {
    code: 'VALIDATEUR',
    libelle: 'Validateur de budget',
    description:
      'Valide ou rejette les versions soumises par les saisisseurs de son périmètre. Ne saisit pas lui-même (séparation des tâches).',
    permissions: [
      'BUDGET.LIRE',
      'BUDGET.VALIDER',
      'REFERENTIEL.LIRE',
      'CONFIGURATION.LIRE',
      'USER.LIRE',
      'AUDIT.LIRE',
    ],
  },
  {
    code: 'PUBLICATEUR',
    libelle: 'Publicateur de budget',
    description:
      'Gèle (publie) les versions validées. Action irréversible. Profil DGA / direction générale.',
    permissions: [
      'BUDGET.LIRE',
      'BUDGET.PUBLIER',
      'REFERENTIEL.LIRE',
      'CONFIGURATION.LIRE',
      'USER.LIRE',
      'AUDIT.LIRE',
    ],
  },
  {
    code: 'AUDITEUR',
    libelle: 'Auditeur',
    description:
      'Lecture seule transverse pour audit interne et contrôle externe BCEAO. Aucun droit d\'écriture.',
    permissions: [
      'AUDIT.LIRE',
      'BUDGET.LIRE',
      'REFERENTIEL.LIRE',
      'CONFIGURATION.LIRE',
      'USER.LIRE',
      'ROLE.LIRE',
    ],
  },
];

const PERSONAS_MAPPING: Array<{ email: string; role: string }> = [
  { email: 'dir.retail@miznas.local', role: 'VALIDATEUR' },
  { email: 'adj.retail@miznas.local', role: 'SAISISSEUR' },
  { email: 'dir.corporate@miznas.local', role: 'VALIDATEUR' },
  { email: 'controleur.gestion@miznas.local', role: 'VALIDATEUR' },
  { email: 'auditeur@miznas.local', role: 'AUDITEUR' },
  { email: 'dga.exploitation@miznas.local', role: 'PUBLICATEUR' },
];

export class CreerRolesMetierEtBasculePersonasBSIC1779200000110
  implements MigrationInterface
{
  name = 'CreerRolesMetierEtBasculePersonasBSIC1779200000110';

  public async up(q: QueryRunner): Promise<void> {
    // ─── Section 1 : création des 4 rôles ───────────────────────────
    for (const def of ROLES_DEFINITIONS) {
      await q.query(
        `INSERT INTO "ref_role"
           ("code_role", "libelle", "description",
            "est_actif", "utilisateur_creation")
         VALUES ($1, $2, $3, true, 'system (Lot 4.1-fix3)')
         ON CONFLICT ("code_role") DO NOTHING`,
        [def.code, def.libelle, def.description],
      );
    }

    // ─── Section 2 : bridge_role_permission ─────────────────────────
    // Résolution des ids côté JS (1 SELECT par rôle puis 1 SELECT
    // par permission) pour éviter les sous-SELECT scalaires que
    // pg-mem traite parfois comme tableau (alors que Postgres réel
    // les accepte). Pattern compatible des deux côtés. Idempotence
    // via NOT EXISTS sur (fk_role, fk_permission) — pas d'index
    // UNIQUE en base.
    for (const def of ROLES_DEFINITIONS) {
      const roleRows = (await q.query(
        `SELECT "id" FROM "ref_role" WHERE "code_role" = $1`,
        [def.code],
      )) as Array<{ id: string }>;
      if (roleRows.length === 0) continue;
      const roleId = roleRows[0]!.id;
      for (const permCode of def.permissions) {
        const permRows = (await q.query(
          `SELECT "id" FROM "ref_permission" WHERE "code_permission" = $1`,
          [permCode],
        )) as Array<{ id: string }>;
        if (permRows.length === 0) continue;
        const permId = permRows[0]!.id;
        await q.query(
          `INSERT INTO "bridge_role_permission" ("fk_role", "fk_permission")
           SELECT $1::bigint, $2::bigint
           WHERE NOT EXISTS (
             SELECT 1 FROM "bridge_role_permission"
              WHERE "fk_role" = $1::bigint
                AND "fk_permission" = $2::bigint
           )`,
          [roleId, permId],
        );
      }
    }

    // ─── Section 3 : bascule des 6 personas ─────────────────────────
    // Résolution des ids côté JS (cf. note Section 2). Pour chaque
    // persona : 1 SELECT user + 1 SELECT role, puis UPDATE et INSERT
    // avec ids littéraux castés bigint.
    for (const persona of PERSONAS_MAPPING) {
      const userRows = (await q.query(
        `SELECT "id" FROM "user" WHERE "email" = $1`,
        [persona.email],
      )) as Array<{ id: string }>;
      if (userRows.length === 0) continue;
      const userId = userRows[0]!.id;
      const roleRows = (await q.query(
        `SELECT "id" FROM "ref_role" WHERE "code_role" = $1`,
        [persona.role],
      )) as Array<{ id: string }>;
      if (roleRows.length === 0) continue;
      const newRoleId = roleRows[0]!.id;

      // 3a. Désactiver tous les bridges actifs du persona qui ne
      //     correspondent pas au nouveau rôle métier (typiquement le
      //     LECTEUR/global posé par la migration 1779200000090).
      await q.query(
        `UPDATE "bridge_user_role"
            SET "est_actif" = false,
                "date_modification" = NOW(),
                "utilisateur_modification" = 'system (Lot 4.1-fix3)'
          WHERE "fk_user" = $1::bigint
            AND "est_actif" = true
            AND "fk_role" <> $2::bigint`,
        [userId, newRoleId],
      );

      // 3b. Insérer le nouveau bridge (rôle métier, perimetre_type
      //     'global' temporairement — le multi-périmètres opère via
      //     user_perimetres, cf. Lot 4.1-fix2.A). Idempotent via
      //     NOT EXISTS sur (fk_user, fk_role, est_actif=true).
      await q.query(
        `INSERT INTO "bridge_user_role"
           ("fk_user", "fk_role", "perimetre_type", "perimetre_id",
            "est_actif", "utilisateur_creation")
         SELECT $1::bigint, $2::bigint, 'global', NULL, true, 'system (Lot 4.1-fix3)'
         WHERE NOT EXISTS (
           SELECT 1 FROM "bridge_user_role"
            WHERE "fk_user" = $1::bigint
              AND "fk_role" = $2::bigint
              AND "est_actif" = true
         )`,
        [userId, newRoleId],
      );
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    // 1. Retirer les bridges des personas (DELETE physique car ces
    //    bridges ont été créés par cette migration).
    for (const persona of PERSONAS_MAPPING) {
      const userRows = (await q.query(
        `SELECT "id" FROM "user" WHERE "email" = $1`,
        [persona.email],
      )) as Array<{ id: string }>;
      const roleRows = (await q.query(
        `SELECT "id" FROM "ref_role" WHERE "code_role" = $1`,
        [persona.role],
      )) as Array<{ id: string }>;
      if (userRows.length === 0 || roleRows.length === 0) continue;
      await q.query(
        `DELETE FROM "bridge_user_role"
          WHERE "fk_user" = $1::bigint AND "fk_role" = $2::bigint`,
        [userRows[0]!.id, roleRows[0]!.id],
      );
    }
    // 2. Réactiver l'ancien bridge LECTEUR/global pour chaque persona.
    const lecteurRows = (await q.query(
      `SELECT "id" FROM "ref_role" WHERE "code_role" = 'LECTEUR'`,
    )) as Array<{ id: string }>;
    if (lecteurRows.length > 0) {
      const lecteurId = lecteurRows[0]!.id;
      for (const persona of PERSONAS_MAPPING) {
        const userRows = (await q.query(
          `SELECT "id" FROM "user" WHERE "email" = $1`,
          [persona.email],
        )) as Array<{ id: string }>;
        if (userRows.length === 0) continue;
        await q.query(
          `UPDATE "bridge_user_role"
              SET "est_actif" = true,
                  "date_modification" = NOW(),
                  "utilisateur_modification" = 'system (Lot 4.1-fix3 down)'
            WHERE "fk_user" = $1::bigint
              AND "fk_role" = $2::bigint
              AND "est_actif" = false`,
          [userRows[0]!.id, lecteurId],
        );
      }
    }
    // 3. Supprimer les bridges role-permission des 4 rôles.
    const codes = ROLES_DEFINITIONS.map((r) => r.code);
    const placeholders = codes.map((_, i) => `$${i + 1}`).join(',');
    await q.query(
      `DELETE FROM "bridge_role_permission"
        WHERE "fk_role" IN (
          SELECT "id" FROM "ref_role" WHERE "code_role" IN (${placeholders})
        )`,
      codes,
    );
    // 4. Supprimer les 4 rôles.
    await q.query(
      `DELETE FROM "ref_role" WHERE "code_role" IN (${placeholders})`,
      codes,
    );
  }
}
