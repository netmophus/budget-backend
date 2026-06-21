import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fix verrou import Excel — code audit de la tentative d'import sur un
 * CR verrouillé (SOUMIS/VALIDE). Tracé pour la sécurité métier du
 * workflow par CR (un import ne doit pas écraser une saisie déjà
 * soumise/validée). Additive et idempotente. Aligné avec `TypeAction`
 * (vérifié par scripts/check-audit-codes-coherence.js).
 */
const CODES: Array<{
  code: string;
  libelle: string;
  description: string;
  ordre: number;
}> = [
  {
    code: 'IMPORT_BUDGET_BLOQUE_CR',
    libelle: 'Import bloqué (CR verrouillé)',
    description:
      'Import en masse refusé : au moins un CR du fichier est au statut SOUMIS ou VALIDE et ne peut être modifié par import.',
    ordre: 610,
  },
];

export class AjouterCodeAuditImportBloqueCr1779200000540 implements MigrationInterface {
  name = 'AjouterCodeAuditImportBloqueCr1779200000540';

  public async up(q: QueryRunner): Promise<void> {
    for (const c of CODES) {
      await q.query(
        `INSERT INTO "ref_type_action_audit"
           ("code","libelle","description","ordre","est_systeme","est_actif","utilisateur_creation")
         VALUES ($1, $2, $3, $4, true, true, 'system (fix verrou import CR)')
         ON CONFLICT ("code") DO NOTHING`,
        [c.code, c.libelle, c.description, c.ordre],
      );
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      `DELETE FROM "ref_type_action_audit"
        WHERE "code" IN ('IMPORT_BUDGET_BLOQUE_CR')`,
    );
  }
}
