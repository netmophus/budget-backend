import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Régularisation RBAC métier — affectations rôle→permission appliquées
 * manuellement en recette mais jamais captées par une migration.
 *
 * Même nature que la migration 520 (FixRbacMetierWorkflowPermissions) :
 * l'intention RBAC existait, mais les bridges n'avaient été posés qu'à la
 * main sur la base de recette → un environnement reconstruit uniquement à
 * partir des migrations (Heroku, reprise après sinistre, CI) obtenait un
 * RBAC INCOMPLET. Ce constat vient d'une comparaison base-recette vs
 * base-migrations-from-scratch.
 *
 * Deux blocs :
 *  1. COORDINATEUR — jeu de permissions complet du coordinateur budgétaire
 *     (la migration 480 ne lui posait que BUDGET.LIRE + BUDGET.COORDONNER).
 *  2. AI.ANALYSER — accordée aux rôles séniors (VALIDATEUR, PUBLICATEUR,
 *     AUDITEUR, COORDINATEUR). Régularise la dette « AI.ANALYSER incomplète ».
 *
 * Idempotent (NOT EXISTS) + tolérant : n'insère que si le rôle ET la
 * permission existent déjà (toutes créées par des migrations antérieures).
 */
const BRIDGES: Array<[string, string]> = [
  // 1. COORDINATEUR — jeu complet.
  ['COORDINATEUR', 'AI.ANALYSER'],
  ['COORDINATEUR', 'BUDGET.SAISIR'],
  ['COORDINATEUR', 'BUDGET.SOUMETTRE'],
  ['COORDINATEUR', 'CAMPAGNE.GERER'],
  ['COORDINATEUR', 'CONFIGURATION.LIRE'],
  ['COORDINATEUR', 'DOCUMENT.CREER'],
  ['COORDINATEUR', 'DOCUMENT.LIRE'],
  ['COORDINATEUR', 'DOCUMENT.VISER'],
  ['COORDINATEUR', 'REFERENTIEL.LIRE'],
  ['COORDINATEUR', 'USER.LIRE'],
  // 2. AI.ANALYSER pour les rôles séniors.
  ['AUDITEUR', 'AI.ANALYSER'],
  ['PUBLICATEUR', 'AI.ANALYSER'],
  ['VALIDATEUR', 'AI.ANALYSER'],
];

export class RegulariserRbacMetierCoordinateurEtAi1779200000650 implements MigrationInterface {
  name = 'RegulariserRbacMetierCoordinateurEtAi1779200000650';

  public async up(q: QueryRunner): Promise<void> {
    for (const [roleCode, permCode] of BRIDGES) {
      await q.query(
        `INSERT INTO "bridge_role_permission" ("fk_role", "fk_permission")
         SELECT r."id", p."id"
           FROM "ref_role" r, "ref_permission" p
          WHERE r."code_role" = $1
            AND p."code_permission" = $2
            AND NOT EXISTS (
              SELECT 1 FROM "bridge_role_permission" b
               WHERE b."fk_role" = r."id"
                 AND b."fk_permission" = p."id"
            )`,
        [roleCode, permCode],
      );
    }
  }

  public async down(): Promise<void> {
    // No-op volontaire : état RBAC correct attendu par le design métier
    // (même logique que la migration 520). Le retirer recasserait les
    // rôles COORDINATEUR / séniors.
  }
}
