import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fix RBAC — répare les bridges rôle métier ↔ permission de workflow.
 *
 * **Cause** : la migration 110 (CreerRolesMetierEtBasculePersonasBSIC)
 * rattache les permissions aux rôles métier via `SELECT` — elles doivent
 * donc PRÉEXISTER en base au moment où 110 s'exécute. Les permissions de
 * workflow `BUDGET.SOUMETTRE` / `BUDGET.VALIDER` / `BUDGET.PUBLIER` (Lot
 * 3.5) n'étaient pas seedées quand 110 a tourné en production → les
 * bridges correspondants ont été **silencieusement skippés**.
 * Conséquence observée : un SAISISSEUR n'a pas `BUDGET.SOUMETTRE` (bouton
 * « Soumettre au validateur » invisible) ; idem VALIDATEUR/PUBLICATEUR.
 *
 * Cette migration est **idempotente** (NOT EXISTS, même pattern que 110)
 * et ré-applique l'intention de 110 maintenant que les permissions
 * existent : elle garantit la permission (insert si absente) puis le
 * bridge rôle→permission. Sans effet si le bridge est déjà présent.
 */
interface IdRow {
  id: string;
}

const PERMISSIONS: Array<{
  code: string;
  libelle: string;
  description: string;
}> = [
  {
    code: 'BUDGET.SOUMETTRE',
    libelle: 'Soumettre un budget',
    description: 'Soumettre une saisie / version budgétaire à validation.',
  },
  {
    code: 'BUDGET.VALIDER',
    libelle: 'Valider un budget',
    description: 'Valider ou rejeter une saisie / version soumise.',
  },
  {
    code: 'BUDGET.PUBLIER',
    libelle: 'Publier un budget',
    description: 'Publier (geler) une version validée.',
  },
];

const BRIDGES: Array<[string, string]> = [
  ['SAISISSEUR', 'BUDGET.SOUMETTRE'],
  ['VALIDATEUR', 'BUDGET.VALIDER'],
  ['PUBLICATEUR', 'BUDGET.PUBLIER'],
];

export class FixRbacMetierWorkflowPermissions1779200000520 implements MigrationInterface {
  name = 'FixRbacMetierWorkflowPermissions1779200000520';

  public async up(q: QueryRunner): Promise<void> {
    // 1. Garantir les permissions (filet : normalement déjà seedées).
    for (const p of PERMISSIONS) {
      await q.query(
        // $1 est utilisé en valeur d'INSERT ET en comparaison WHERE :
        // Postgres réel n'infère pas un type unique (text vs varchar,
        // erreur 42P08). On caste explicitement aux deux endroits.
        // pg-mem est plus tolérant et ne détectait pas le souci.
        `INSERT INTO "ref_permission"
           ("code_permission","libelle","description","module","utilisateur_creation")
         SELECT $1::varchar, $2, $3, 'BUDGET', 'system (fix RBAC workflow)'
         WHERE NOT EXISTS (
           SELECT 1 FROM "ref_permission" WHERE "code_permission" = $1::varchar
         )`,
        [p.code, p.libelle, p.description],
      );
    }

    // 2. (Re)créer les bridges rôle métier → permission workflow.
    for (const [roleCode, permCode] of BRIDGES) {
      const roleRows = (await q.query(
        `SELECT "id" FROM "ref_role" WHERE "code_role" = $1`,
        [roleCode],
      )) as IdRow[];
      if (roleRows.length === 0) continue;
      const permRows = (await q.query(
        `SELECT "id" FROM "ref_permission" WHERE "code_permission" = $1`,
        [permCode],
      )) as IdRow[];
      if (permRows.length === 0) continue;
      const roleId = roleRows[0]!.id;
      const permId = permRows[0]!.id;
      await q.query(
        `INSERT INTO "bridge_role_permission" ("fk_role", "fk_permission")
         SELECT $1::bigint, $2::bigint
         WHERE NOT EXISTS (
           SELECT 1 FROM "bridge_role_permission"
            WHERE "fk_role" = $1::bigint AND "fk_permission" = $2::bigint
         )`,
        [roleId, permId],
      );
    }
  }

  public async down(): Promise<void> {
    // No-op volontaire : ces bridges sont l'état RBAC correct attendu par
    // le design (migration 110). Les retirer recasserait le workflow.
    // La permission n'est pas supprimée (partagée avec d'autres rôles).
  }
}
