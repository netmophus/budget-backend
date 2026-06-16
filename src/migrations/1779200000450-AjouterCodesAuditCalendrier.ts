import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lot 8.7.A — codes audit de l'edition du calendrier.
 *
 * 2 codes (ordres 321-322, module REFERENTIEL) :
 *  - MODIFIER_JOUR_CALENDRIER : PATCH d'un jour (jour_ouvre, fins de
 *    periode, libelle_jour). payloadAvant/Apres pour diff applicatif.
 *  - ETENDRE_CALENDRIER : POST d'extension sur une plage d'annees.
 *    payloadApres = anneeDebut + anneeFin + nbJoursAjoutes + dureeMs.
 *
 * Insertions idempotentes via ON CONFLICT DO NOTHING.
 */
export class AjouterCodesAuditCalendrier1779200000450 implements MigrationInterface {
  name = 'AjouterCodesAuditCalendrier1779200000450';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      INSERT INTO "ref_type_action_audit"
        ("code","libelle","description","ordre","est_systeme","est_actif","utilisateur_creation")
      VALUES
        ('MODIFIER_JOUR_CALENDRIER',
         'Modifier un jour du calendrier',
         'Edition d''un jour de dim_temps (jour_ouvre, est_fin_de_*, libelle_jour) par un ADMIN. payloadAvant/Apres contiennent les champs editables. Lot 8.7.A.',
         321, true, true, 'system (Lot 8.7.A)'),
        ('ETENDRE_CALENDRIER',
         'Etendre le calendrier',
         'Generation de nouvelles annees dans dim_temps (ON CONFLICT DO NOTHING). payloadApres = anneeDebut + anneeFin + nbJoursAjoutes + dureeMs. Lot 8.7.A.',
         322, true, true, 'system (Lot 8.7.A)')
      ON CONFLICT ("code") DO NOTHING
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`
      DELETE FROM "ref_type_action_audit"
       WHERE "code" IN ('MODIFIER_JOUR_CALENDRIER','ETENDRE_CALENDRIER')
    `);
  }
}
