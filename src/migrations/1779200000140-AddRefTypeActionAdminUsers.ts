import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lot Administration — 8 codes audit pour la gestion des utilisateurs
 * et des rôles depuis l'UI admin.
 *
 * Ajoute :
 *  - CREER_USER, MODIFIER_USER (CRUD basique)
 *  - DESACTIVER_USER, REACTIVER_USER (soft-delete)
 *  - RESET_PASSWORD_USER (mot de passe en clair JAMAIS stocké
 *    dans l'audit_log — uniquement le fait que l'action a eu lieu)
 *  - FORCER_DECONNEXION_USER (révoque tous les refresh_token actifs)
 *  - ATTRIBUER_ROLE, RETIRER_ROLE (gestion des affectations rôles)
 *
 * Idempotent : ON CONFLICT (code) DO NOTHING.
 */
export class AddRefTypeActionAdminUsers1779200000140 implements MigrationInterface {
  name = 'AddRefTypeActionAdminUsers1779200000140';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      INSERT INTO "ref_type_action_audit"
        ("code", "libelle", "description", "ordre", "est_systeme",
         "est_actif", "utilisateur_creation")
      VALUES
        ('CREER_USER',
         'Créer un utilisateur',
         'Création complète d''un user via UI admin (mot de passe initial fourni). Lot Administration.',
         200, true, true, 'system (Lot Admin)'),
        ('MODIFIER_USER',
         'Modifier un utilisateur',
         'PATCH des champs nom/prenom/email d''un user. Lot Administration.',
         201, true, true, 'system (Lot Admin)'),
        ('DESACTIVER_USER',
         'Désactiver un utilisateur',
         'Passage est_actif=false. Auto-désactivation interdite. Lot Administration.',
         202, true, true, 'system (Lot Admin)'),
        ('REACTIVER_USER',
         'Réactiver un utilisateur',
         'Passage est_actif=true. Lot Administration.',
         203, true, true, 'system (Lot Admin)'),
        ('RESET_PASSWORD_USER',
         'Réinitialiser le mot de passe d''un user',
         'Génère un mot de passe temporaire 12+ caractères, hash bcrypt cost 10. Mot de passe en clair JAMAIS stocké dans l''audit. Lot Administration.',
         204, true, true, 'system (Lot Admin)'),
        ('FORCER_DECONNEXION_USER',
         'Forcer la déconnexion d''un user',
         'Révoque tous les refresh_token actifs du user (motif=admin_force). Lot Administration.',
         205, true, true, 'system (Lot Admin)'),
        ('ATTRIBUER_ROLE',
         'Attribuer un rôle à un user',
         'INSERT/UPDATE bridge_user_role est_actif=true. Idempotent. Lot Administration.',
         206, true, true, 'system (Lot Admin)'),
        ('RETIRER_ROLE',
         'Retirer un rôle d''un user',
         'UPDATE bridge_user_role est_actif=false. Garde-fou : un user doit toujours avoir ≥1 rôle actif. Lot Administration.',
         207, true, true, 'system (Lot Admin)')
      ON CONFLICT ("code") DO NOTHING
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`
      DELETE FROM "ref_type_action_audit"
       WHERE "code" IN (
         'CREER_USER','MODIFIER_USER','DESACTIVER_USER','REACTIVER_USER',
         'RESET_PASSWORD_USER','FORCER_DECONNEXION_USER',
         'ATTRIBUER_ROLE','RETIRER_ROLE'
       )
    `);
  }
}
