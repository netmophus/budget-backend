import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration Lot 8.5.B — Ajouter les permissions REALISE.* au rôle ADMIN.
 *
 * **Contexte** : audit pré-Lot 8.5.B a révélé que le rôle ADMIN possède
 * 6 permissions BUDGET.* mais ZÉRO permission REALISE.* — alors que les
 * 4 autres rôles métier (AUDITEUR, PUBLICATEUR, SAISISSEUR, VALIDATEUR)
 * en ont au moins une. C'est un oubli du seed initial des permissions.
 *
 * **Conséquences avant ce fix** pour `admin@miznas.local` :
 *  - Groupe sidebar "EXÉCUTION" (`NAV_EXECUTION` dans
 *    `AuthLayout.tsx:163-189`) entièrement masqué — le NavGroup est
 *    gardé par REALISE.LIRE.
 *  - 403 sur `/tableau-de-bord/budget-vs-realise` (endpoint backend
 *    `@RequirePermissions({ all: ['BUDGET.LIRE', 'REALISE.LIRE'] })`).
 *  - Impossibilité de valider visuellement le seed pilote Lot 8.5.A
 *    (42 lignes dans `fait_realise`) malgré son application en base.
 *
 * **Action** : ajout des 5 permissions REALISE.* présentes dans
 * `ref_permission` au rôle ADMIN, via INSERT idempotent dans
 * `bridge_role_permission`. L'utilisateur devra se déconnecter /
 * reconnecter pour rafraîchir le JWT.
 *
 * **Architecture** :
 *  - Aucun id hardcodé : ADMIN + permissions REALISE.* résolus
 *    dynamiquement via SELECT (robustesse multi-environnements).
 *  - `INSERT ... ON CONFLICT (fk_role, fk_permission) DO NOTHING`
 *    exploite la contrainte UNIQUE existante de `bridge_role_permission`
 *    — re-run safe par construction (pas de WHERE NOT EXISTS verbeux).
 *  - `RETURNING fk_permission` pour log précis du nombre + libellés
 *    réellement insérés (vs déjà présents).
 *
 * **Structure de `bridge_role_permission`** (4 colonnes simples) :
 *   - id (bigint identity)
 *   - fk_role (bigint NOT NULL FK CASCADE)
 *   - fk_permission (bigint NOT NULL FK CASCADE)
 *   - date_creation (timestamp NOT NULL DEFAULT now())
 *   - UNIQUE (fk_role, fk_permission)
 * Aucune colonne `utilisateur_creation` à remplir.
 *
 * **Permissions REALISE.* visées (résolues dynamiquement)** :
 *   - REALISE.LIRE     (lecture dashboard, saisie, reforecast)
 *   - REALISE.SAISIR   (saisie manuelle réalisé)
 *   - REALISE.VALIDER  (validation des lignes IMPORTE → VALIDE)
 *   - REALISE.IMPORTER (import Excel/CSV)
 *   - REALISE.SUPPRIMER (suppression lignes saisies)
 */

interface RoleRow {
  id: string;
}

interface PermissionRow {
  id: string;
  code_permission: string;
}

interface InsertedRow {
  fk_permission: string;
}

export class AjouterPermissionsRealiseADMIN1779200000400 implements MigrationInterface {
  name = 'AjouterPermissionsRealiseADMIN1779200000400';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ─── 1. Résolution dynamique du rôle ADMIN ─────────────────────
    const adminRows = (await queryRunner.query(
      `SELECT id FROM ref_role WHERE code_role = 'ADMIN' LIMIT 1`,
    )) as RoleRow[];
    if (adminRows.length === 0) {
      throw new Error(
        "Rôle 'ADMIN' introuvable dans ref_role — prérequis du seed 8.5.B.",
      );
    }
    const adminRoleId = String(adminRows[0].id);

    // ─── 2. Inventaire des permissions REALISE.* disponibles ───────
    const allRealise = (await queryRunner.query(
      `SELECT id, code_permission FROM ref_permission
       WHERE code_permission LIKE 'REALISE.%'
       ORDER BY code_permission`,
    )) as PermissionRow[];
    console.log(
      `[Migration 8.5.B] Permissions REALISE.* présentes dans ref_permission : ` +
        `${allRealise.length} trouvée(s) — [${allRealise.map((p) => p.code_permission).join(', ')}]`,
    );
    if (allRealise.length === 0) {
      console.warn(
        `[Migration 8.5.B] AUCUNE permission REALISE.* en base — rien à ajouter.`,
      );
      return;
    }

    // ─── 3. INSERT idempotent via ON CONFLICT sur UNIQUE ───────────
    const inserted = (await queryRunner.query(
      `INSERT INTO bridge_role_permission (fk_role, fk_permission)
       SELECT $1::bigint, p.id FROM ref_permission p
       WHERE p.code_permission LIKE 'REALISE.%'
       ON CONFLICT (fk_role, fk_permission) DO NOTHING
       RETURNING fk_permission`,
      [adminRoleId],
    )) as InsertedRow[];

    if (inserted.length === 0) {
      console.log(
        `[Migration 8.5.B] Aucune permission ajoutée — toutes les permissions ` +
          `REALISE.* étaient déjà attribuées au rôle ADMIN (idempotence).`,
      );
      return;
    }

    // ─── 4. Log précis des permissions effectivement ajoutées ──────
    const insertedIds = new Set(inserted.map((r) => String(r.fk_permission)));
    const insertedDetails = allRealise.filter((p) => insertedIds.has(p.id));
    console.log(
      `[Migration 8.5.B] ${inserted.length} permission(s) REALISE.* ajoutée(s) ` +
        `au rôle ADMIN (role_id=${adminRoleId}) :`,
    );
    insertedDetails.forEach((p) =>
      console.log(`  + ${p.code_permission} (permission_id=${p.id})`),
    );
    console.log(
      `[Migration 8.5.B] ⚠️ admin@miznas.local doit se déconnecter / ` +
        `reconnecter pour rafraîchir le JWT et voir le groupe sidebar EXÉCUTION.`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const result = (await queryRunner.query(
      `DELETE FROM bridge_role_permission
       WHERE fk_role = (SELECT id FROM ref_role WHERE code_role = 'ADMIN')
       AND fk_permission IN (
         SELECT id FROM ref_permission WHERE code_permission LIKE 'REALISE.%'
       )`,
    )) as unknown as [unknown, number] | undefined;
    const deletedCount = Array.isArray(result) ? result[1] : 0;
    console.log(
      `[Migration 8.5.B] Rollback : ${deletedCount} permission(s) REALISE.* ` +
        `retirée(s) du rôle ADMIN.`,
    );
  }
}
