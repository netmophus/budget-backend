import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lot workflow par CR — codes audit des transitions par CR + Comité.
 *
 * Doit rester aligné avec le type union `TypeAction`
 * (`audit-log.entity.ts`), vérifié par
 * `scripts/check-audit-codes-coherence.js`. Idempotent.
 */
const CODES: Array<{
  code: string;
  libelle: string;
  description: string;
  ordre: number;
}> = [
  {
    code: 'SOUMETTRE_CR',
    libelle: 'Soumission CR',
    description:
      'Un saisisseur a soumis la saisie de son CR à validation (EN_SAISIE → SOUMIS).',
    ordre: 500,
  },
  {
    code: 'VALIDER_CR',
    libelle: 'Validation CR',
    description: 'Un validateur a validé la saisie d’un CR (SOUMIS → VALIDE).',
    ordre: 510,
  },
  {
    code: 'REJETER_CR',
    libelle: 'Rejet CR',
    description:
      'Un validateur a rejeté la saisie d’un CR (SOUMIS → EN_SAISIE), motif obligatoire.',
    ordre: 520,
  },
  {
    code: 'ROUVRIR_CR',
    libelle: 'Réouverture CR',
    description:
      'Un validateur a rouvert un CR validé (VALIDE → EN_SAISIE), motif obligatoire.',
    ordre: 530,
  },
  {
    code: 'SOUMETTRE_COMITE',
    libelle: 'Soumission au Comité',
    description:
      'Le Coordinateur a soumis une version pré-validée au Comité (PRE_VALIDE → SOUMIS_COMITE).',
    ordre: 540,
  },
];

export class AjouterCodesAuditWorkflowCr1779200000500 implements MigrationInterface {
  name = 'AjouterCodesAuditWorkflowCr1779200000500';

  public async up(q: QueryRunner): Promise<void> {
    for (const c of CODES) {
      await q.query(
        `INSERT INTO "ref_type_action_audit"
           ("code","libelle","description","ordre","est_systeme","est_actif","utilisateur_creation")
         VALUES ($1, $2, $3, $4, true, true, 'system (Lot workflow CR)')
         ON CONFLICT ("code") DO NOTHING`,
        [c.code, c.libelle, c.description, c.ordre],
      );
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      `DELETE FROM "ref_type_action_audit"
        WHERE "code" IN ('SOUMETTRE_CR','VALIDER_CR','REJETER_CR','ROUVRIR_CR','SOUMETTRE_COMITE')`,
    );
  }
}
