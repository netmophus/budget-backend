import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Durcissement workflow snapshot CR — code audit de la réintégration
 * d'un CR retiré du snapshot (action Coordinateur inverse de
 * RETIRER_CR_SNAPSHOT). Additive et idempotente. Aligné avec
 * `TypeAction` (vérifié par scripts/check-audit-codes-coherence.js).
 */
const CODES: Array<{
  code: string;
  libelle: string;
  description: string;
  ordre: number;
}> = [
  {
    code: 'CR_REINTEGRE_SNAPSHOT',
    libelle: 'Réintégration CR au snapshot',
    description:
      'Le Coordinateur a réintégré un CR précédemment retiré du snapshot des CR attendus (actif=false → true). Réservé aux versions OUVERTES.',
    ordre: 620,
  },
];

export class AjouterCodeAuditReintegreSnapshot1779200000550 implements MigrationInterface {
  name = 'AjouterCodeAuditReintegreSnapshot1779200000550';

  public async up(q: QueryRunner): Promise<void> {
    for (const c of CODES) {
      await q.query(
        `INSERT INTO "ref_type_action_audit"
           ("code","libelle","description","ordre","est_systeme","est_actif","utilisateur_creation")
         VALUES ($1, $2, $3, $4, true, true, 'system (durcissement snapshot CR)')
         ON CONFLICT ("code") DO NOTHING`,
        [c.code, c.libelle, c.description, c.ordre],
      );
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      `DELETE FROM "ref_type_action_audit"
        WHERE "code" IN ('CR_REINTEGRE_SNAPSHOT')`,
    );
  }
}
