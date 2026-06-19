import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Mini-PR transitions Comité — codes audit de la sortie du statut
 * `soumis_comite` (workflow par CR) :
 *   - APPROUVER_COMITE         : soumis_comite → valide (approbation).
 *   - DEMANDER_REVISION_COMITE : soumis_comite → ouvert + CR ciblé
 *     VALIDE → EN_SAISIE (renvoi en révision).
 *
 * Additive et idempotente. Aligné avec `TypeAction`
 * (vérifié par scripts/check-audit-codes-coherence.js). Ne touche PAS
 * au workflow version-globale legacy (coexistence Option A).
 */
const CODES: Array<{
  code: string;
  libelle: string;
  description: string;
  ordre: number;
}> = [
  {
    code: 'APPROUVER_COMITE',
    libelle: 'Approbation version (Comité)',
    description:
      'Le Comité a approuvé une version soumise : SOUMIS_COMITE → VALIDE.',
    ordre: 590,
  },
  {
    code: 'DEMANDER_REVISION_COMITE',
    libelle: 'Demande de révision (Comité)',
    description:
      'Le Comité renvoie un CR validé en révision : version SOUMIS_COMITE → OUVERT et CR ciblé VALIDE → EN_SAISIE.',
    ordre: 600,
  },
];

export class AjouterCodesAuditComiteTransitions1779200000530 implements MigrationInterface {
  name = 'AjouterCodesAuditComiteTransitions1779200000530';

  public async up(q: QueryRunner): Promise<void> {
    for (const c of CODES) {
      await q.query(
        `INSERT INTO "ref_type_action_audit"
           ("code","libelle","description","ordre","est_systeme","est_actif","utilisateur_creation")
         VALUES ($1, $2, $3, $4, true, true, 'system (transitions Comité)')
         ON CONFLICT ("code") DO NOTHING`,
        [c.code, c.libelle, c.description, c.ordre],
      );
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      `DELETE FROM "ref_type_action_audit"
        WHERE "code" IN ('APPROUVER_COMITE','DEMANDER_REVISION_COMITE')`,
    );
  }
}
