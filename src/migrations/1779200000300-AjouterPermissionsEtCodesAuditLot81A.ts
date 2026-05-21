import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lot 8.1.A — Permissions RBAC + codes audit du workflow signature.
 *
 * 5 permissions (module DOCUMENTS) :
 *  - CAMPAGNE.GERER       → ADMIN + PUBLICATEUR (DG nomine le Comite)
 *  - DOCUMENT.LIRE        → tous roles authentifies (6)
 *  - DOCUMENT.CREER       → ADMIN + SAISISSEUR (emetteur du document)
 *  - DOCUMENT.VISER       → ADMIN + SAISISSEUR + VALIDATEUR (le code
 *                            applicatif filtrera AUSSI sur l'appartenance
 *                            au comite de la campagne — double check)
 *  - DOCUMENT.SIGNER      → ADMIN + PUBLICATEUR (DG signataire final)
 *
 * 6 codes audit (ordres 310-315) :
 *  - CREER_DOCUMENT, EDITER_DOCUMENT
 *  - SOUMETTRE_DOCUMENT_VISA, VISER_DOCUMENT, REJETER_DOCUMENT
 *  - SIGNER_DOCUMENT
 *
 * Toutes les insertions sont idempotentes via ON CONFLICT DO NOTHING.
 *
 * NB : `DOCUMENT.VISER` est attribuee a 3 roles mais le code Lot 8.1.B
 * verifiera EN PLUS que `user IN comite_membres(campagne)`. Cette
 * granularite dynamique ne peut pas etre exprimee dans bridge_role_permission.
 */
export class AjouterPermissionsEtCodesAuditLot81A1779200000300 implements MigrationInterface {
  name = 'AjouterPermissionsEtCodesAuditLot81A1779200000300';

  public async up(q: QueryRunner): Promise<void> {
    // ─── 1. Permissions DOCUMENTS.* ──────────────────────────────────
    await q.query(`
      INSERT INTO "ref_permission" ("code_permission","libelle","description","module","utilisateur_creation")
      VALUES
        ('CAMPAGNE.GERER',
         'Gérer les campagnes budgétaires',
         'Créer, modifier, lancer, terminer une campagne. Nomination du Comité visa. Réservé au DG (PUBLICATEUR) et aux administrateurs.',
         'DOCUMENTS','system (Lot 8.1.A)'),
        ('DOCUMENT.LIRE',
         'Consulter les documents officiels',
         'Lire les documents officiels (lettres, notes, PV de gel, etc.) tous statuts confondus. Accès large pour traçabilité interne.',
         'DOCUMENTS','system (Lot 8.1.A)'),
        ('DOCUMENT.CREER',
         'Créer / éditer un document officiel',
         'Créer un nouveau document en statut BROUILLON, l''éditer tant qu''il n''est pas soumis. Réservé aux émetteurs (DAF, coordinateur budget).',
         'DOCUMENTS','system (Lot 8.1.A)'),
        ('DOCUMENT.VISER',
         'Viser ou rejeter un document soumis',
         'Apposer son visa (ou motif de rejet) sur un document en statut SOUMIS_VISA. Permission technique : le service Lot 8.1.B verifiera en plus que user IN comite_membres(campagne).',
         'DOCUMENTS','system (Lot 8.1.A)'),
        ('DOCUMENT.SIGNER',
         'Signer un document VISE',
         'Apposer la signature finale sur un document en statut VISE. Capture empreinte cryptographique + audit. Reserve au DG signataire de la campagne.',
         'DOCUMENTS','system (Lot 8.1.A)')
      ON CONFLICT ("code_permission") DO NOTHING
    `);

    // ─── 2. Attribution permissions par role ─────────────────────────
    const ATTRIBUTIONS: Array<[string, string]> = [
      // CAMPAGNE.GERER
      ['ADMIN', 'CAMPAGNE.GERER'],
      ['PUBLICATEUR', 'CAMPAGNE.GERER'],
      // DOCUMENT.LIRE — tous les roles authentifies
      ['ADMIN', 'DOCUMENT.LIRE'],
      ['SAISISSEUR', 'DOCUMENT.LIRE'],
      ['VALIDATEUR', 'DOCUMENT.LIRE'],
      ['PUBLICATEUR', 'DOCUMENT.LIRE'],
      ['AUDITEUR', 'DOCUMENT.LIRE'],
      ['LECTEUR', 'DOCUMENT.LIRE'],
      // DOCUMENT.CREER — emetteurs (DAF, coordinateur)
      ['ADMIN', 'DOCUMENT.CREER'],
      ['SAISISSEUR', 'DOCUMENT.CREER'],
      // DOCUMENT.VISER — viseurs (filtrage applicatif sur comite en plus)
      ['ADMIN', 'DOCUMENT.VISER'],
      ['SAISISSEUR', 'DOCUMENT.VISER'],
      ['VALIDATEUR', 'DOCUMENT.VISER'],
      // DOCUMENT.SIGNER — DG
      ['ADMIN', 'DOCUMENT.SIGNER'],
      ['PUBLICATEUR', 'DOCUMENT.SIGNER'],
    ];
    for (const [roleCode, permCode] of ATTRIBUTIONS) {
      const roleRows = (await q.query(
        `SELECT "id" FROM "ref_role" WHERE "code_role" = $1`,
        [roleCode],
      )) as Array<{ id: string }>;
      const permRows = (await q.query(
        `SELECT "id" FROM "ref_permission" WHERE "code_permission" = $1`,
        [permCode],
      )) as Array<{ id: string }>;
      if (roleRows.length === 0 || permRows.length === 0) continue;
      await q.query(
        `INSERT INTO "bridge_role_permission" ("fk_role","fk_permission")
         SELECT $1::bigint, $2::bigint
         WHERE NOT EXISTS (
           SELECT 1 FROM "bridge_role_permission"
            WHERE "fk_role" = $1::bigint AND "fk_permission" = $2::bigint
         )`,
        [roleRows[0]!.id, permRows[0]!.id],
      );
    }

    // ─── 3. Codes audit ──────────────────────────────────────────────
    await q.query(`
      INSERT INTO "ref_type_action_audit"
        ("code","libelle","description","ordre","est_systeme","est_actif","utilisateur_creation")
      VALUES
        ('CREER_DOCUMENT',
         'Créer un document officiel',
         'Creation d''un document_officiel en statut BROUILLON. payloadApres contient code_document + type_document + fk_campagne. Lot 8.1.A.',
         310, true, true, 'system (Lot 8.1.A)'),
        ('EDITER_DOCUMENT',
         'Éditer un document officiel',
         'Modification d''un document en BROUILLON (titre, contenu_html, contenu_json). payloadAvant/Apres pour diff applicatif. Lot 8.1.A.',
         311, true, true, 'system (Lot 8.1.A)'),
        ('SOUMETTRE_DOCUMENT_VISA',
         'Soumettre un document au visa',
         'Transition BROUILLON -> SOUMIS_VISA. Snapshot du comite est genere (N lignes document_visa). Lot 8.1.A.',
         312, true, true, 'system (Lot 8.1.A)'),
        ('VISER_DOCUMENT',
         'Viser un document',
         'Apposition du visa par un membre du comite. document_visa.statut passe a VISE. Si tous les visas obligatoires sont apposes, document_officiel passe a VISE. Lot 8.1.A.',
         313, true, true, 'system (Lot 8.1.A)'),
        ('REJETER_DOCUMENT',
         'Rejeter un document soumis',
         'Refus motive d''un viseur (commentaire obligatoire). document_visa.statut = REJETE. document_officiel retourne en BROUILLON pour correction. Lot 8.1.A.',
         314, true, true, 'system (Lot 8.1.A)'),
        ('SIGNER_DOCUMENT',
         'Signer un document',
         'Signature finale par le DG. Genere document_signature avec hash crypto + IP/UA. Transition VISE -> SIGNE, irreversible. Lot 8.1.A.',
         315, true, true, 'system (Lot 8.1.A)')
      ON CONFLICT ("code") DO NOTHING
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    // Suppression des codes audit (les bridge_role_permission cascade
    // automatiquement via FK ON DELETE CASCADE sur ref_permission).
    await q.query(`
      DELETE FROM "ref_type_action_audit"
       WHERE "code" IN (
         'CREER_DOCUMENT','EDITER_DOCUMENT','SOUMETTRE_DOCUMENT_VISA',
         'VISER_DOCUMENT','REJETER_DOCUMENT','SIGNER_DOCUMENT'
       )
    `);
    await q.query(`
      DELETE FROM "ref_permission"
       WHERE "code_permission" IN (
         'CAMPAGNE.GERER','DOCUMENT.LIRE','DOCUMENT.CREER',
         'DOCUMENT.VISER','DOCUMENT.SIGNER'
       )
    `);
  }
}
