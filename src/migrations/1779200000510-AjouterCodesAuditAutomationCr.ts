import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lot workflow par CR (palier 3) — codes audit de l'automation version
 * + gestion du snapshot des CR attendus. Aligné avec `TypeAction`
 * (vérifié par scripts/check-audit-codes-coherence.js). Idempotent.
 */
const CODES: Array<{
  code: string;
  libelle: string;
  description: string;
  ordre: number;
}> = [
  {
    code: 'PRE_VALIDER_VERSION',
    libelle: 'Pré-validation version (auto)',
    description:
      'Bascule automatique OUVERT → PRE_VALIDE : tous les CR attendus du snapshot sont validés.',
    ordre: 550,
  },
  {
    code: 'REOUVRIR_VERSION',
    libelle: 'Réouverture version (auto)',
    description:
      'Bascule automatique PRE_VALIDE → OUVERT suite à la réouverture d’un CR validé.',
    ordre: 560,
  },
  {
    code: 'INIT_SNAPSHOT_CR',
    libelle: 'Initialisation snapshot CR attendus',
    description:
      'Le Coordinateur a (ré)initialisé le snapshot des CR attendus d’une version (périmètres SAISISSEUR).',
    ordre: 570,
  },
  {
    code: 'RETIRER_CR_SNAPSHOT',
    libelle: 'Retrait CR du snapshot',
    description:
      'Le Coordinateur a retiré manuellement un CR du snapshot des CR attendus (action exceptionnelle).',
    ordre: 580,
  },
];

export class AjouterCodesAuditAutomationCr1779200000510 implements MigrationInterface {
  name = 'AjouterCodesAuditAutomationCr1779200000510';

  public async up(q: QueryRunner): Promise<void> {
    for (const c of CODES) {
      await q.query(
        `INSERT INTO "ref_type_action_audit"
           ("code","libelle","description","ordre","est_systeme","est_actif","utilisateur_creation")
         VALUES ($1, $2, $3, $4, true, true, 'system (Lot workflow CR p3)')
         ON CONFLICT ("code") DO NOTHING`,
        [c.code, c.libelle, c.description, c.ordre],
      );
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      `DELETE FROM "ref_type_action_audit"
        WHERE "code" IN ('PRE_VALIDER_VERSION','REOUVRIR_VERSION','INIT_SNAPSHOT_CR','RETIRER_CR_SNAPSHOT')`,
    );
  }
}
