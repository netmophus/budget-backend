import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lot 4.1-fix.B — Personas budgétaires BSIC Niger pour smoke tests
 * multi-périmètres et délégations Lot 4.2.
 *
 * Avant cette migration : la base ne contient que 2 utilisateurs
 * (admin, lecteur) avec rôle global → impossible de tester les
 * affectations multi-périmètres (effet poulet-œuf).
 *
 * Cette migration crée 6 personas représentatifs d'une banque
 * UEMOA, tous mot de passe `MiznasTest!2026` (bcrypt cost 10),
 * tous est_actif=true. Aucune ligne user_perimetres n'est créée
 * — c'est précisément l'objet du smoke test (créer les
 * affectations via /admin/affectations).
 *
 * Rôle attribué : tous LECTEUR (le seul rôle non-admin disponible
 * en base — la création de rôles fins viendra avec un lot
 * Administration dédié avant le Lot 5). Ces comptes pourront
 * néanmoins être affectés à des périmètres et tester l'ensemble
 * du parcours saisie/workflow grâce au RBAC permissions fines.
 *
 * Idempotente via `ON CONFLICT (email) DO NOTHING` sur "user" et
 * sous-requête `WHERE NOT EXISTS` sur bridge_user_role.
 *
 * Hash bcrypt généré via :
 *   node -e "const b=require('bcrypt');console.log(b.hashSync('MiznasTest!2026', 10))"
 * → $2b$10$Dw2zNbyjcGJPToE9VvjX6O/t4nW4JR70vLkuaGavhCZKdABdB4ueG
 *
 * Note : si vous régénérez le hash, utilisez UN MOT DE PASSE
 * IDENTIQUE sinon les comptes ne pourront plus se connecter.
 */
const HASH_BCRYPT =
  '$2b$10$Dw2zNbyjcGJPToE9VvjX6O/t4nW4JR70vLkuaGavhCZKdABdB4ueG';

interface Persona {
  email: string;
  prenom: string;
  nom: string;
  // Tous les personas ont rôle LECTEUR pour ce fix (cf. en-tête).
  // Le périmètre est laissé NULL (les affectations seront posées
  // via /admin/affectations dans user_perimetres au smoke test).
  description: string;
}

const PERSONAS: Persona[] = [
  {
    email: 'dir.retail@miznas.local',
    prenom: 'Amadou',
    nom: 'Directeur Retail',
    description: 'Directeur Retail — manager validateur Retail',
  },
  {
    email: 'adj.retail@miznas.local',
    prenom: 'Fatima',
    nom: 'Adjoint Retail',
    description: 'Adjoint Retail — soumetteur saisie',
  },
  {
    email: 'dir.corporate@miznas.local',
    prenom: 'Ibrahim',
    nom: 'Directeur Corporate',
    description: 'Directeur Corporate — manager validateur Corporate',
  },
  {
    email: 'controleur.gestion@miznas.local',
    prenom: 'Aïcha',
    nom: 'Contrôleur Gestion',
    description: 'Contrôleur de gestion — vue transverse',
  },
  {
    email: 'auditeur@miznas.local',
    prenom: 'Moussa',
    nom: 'Auditeur',
    description: 'Auditeur — lecture transverse',
  },
  {
    email: 'dga.exploitation@miznas.local',
    prenom: 'Salif',
    nom: 'DGA Exploitation',
    description: 'DGA Exploitation — manager senior',
  },
];

export class AjouterPersonasBSIC1779200000090 implements MigrationInterface {
  name = 'AjouterPersonasBSIC1779200000090';

  public async up(q: QueryRunner): Promise<void> {
    for (const p of PERSONAS) {
      // INSERT du user (idempotent via UNIQUE email)
      await q.query(
        `INSERT INTO "user"
           (email, mot_de_passe_hash, nom, prenom, est_actif, utilisateur_creation)
         VALUES ($1, $2, $3, $4, true, 'system (seed Lot 4.1-fix)')
         ON CONFLICT (email) DO NOTHING`,
        [p.email, HASH_BCRYPT, p.nom, p.prenom],
      );

      // Récupère l'id du user (créé ou existant)
      const userRow = (await q.query(`SELECT id FROM "user" WHERE email = $1`, [
        p.email,
      ])) as Array<{ id: string }>;
      if (userRow.length === 0) {
        // Cas improbable (INSERT a échoué silencieusement) — on log et on continue.
        // eslint-disable-next-line no-console
        console.warn(
          `[Lot 4.1-fix] Persona ${p.email} introuvable après INSERT.`,
        );
        continue;
      }
      const userId = userRow[0]!.id;

      // Récupère l'id du rôle LECTEUR (référence existante en base)
      const roleRow = (await q.query(
        `SELECT id FROM ref_role WHERE code_role = 'LECTEUR' LIMIT 1`,
      )) as Array<{ id: string }>;
      if (roleRow.length === 0) {
        throw new Error(
          "Rôle LECTEUR introuvable dans ref_role — le seed Lot 1 n'a pas été appliqué.",
        );
      }
      const roleId = roleRow[0]!.id;

      // INSERT bridge_user_role (idempotent via WHERE NOT EXISTS).
      // CAST $1::bigint requis pour pg-mem qui ne convertit pas
      // automatiquement les `string` JS en bigint Postgres au binding.
      await q.query(
        `INSERT INTO bridge_user_role
           (fk_user, fk_role, perimetre_type, perimetre_id,
            est_actif, utilisateur_creation)
         SELECT $1::bigint, $2::bigint, 'global', NULL, true, 'system (seed Lot 4.1-fix)'
         WHERE NOT EXISTS (
           SELECT 1 FROM bridge_user_role
            WHERE fk_user = $1::bigint AND fk_role = $2::bigint
              AND est_actif = true
         )`,
        [userId, roleId],
      );
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    const emails = PERSONAS.map((p) => p.email);
    const placeholders = emails.map((_, i) => `$${i + 1}`).join(',');
    // bridge_user_role d'abord (FK)
    await q.query(
      `DELETE FROM bridge_user_role
        WHERE fk_user IN (SELECT id FROM "user" WHERE email IN (${placeholders}))`,
      emails,
    );
    await q.query(
      `DELETE FROM "user" WHERE email IN (${placeholders})`,
      emails,
    );
  }
}
