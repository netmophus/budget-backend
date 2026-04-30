import { MigrationInterface, QueryRunner } from 'typeorm';

import {
  createRefSecondaireTable,
  dropRefSecondaireTable,
  type RefSecondaireSeed,
  seedRefSecondaire,
} from './_helpers/ref-secondaire-migration-helpers';

const TABLE = 'ref_type_action_audit';

/**
 * Types d'action audit_log. Tous système car le code applicatif les
 * pose lors des opérations CRUD / authentification / workflow.
 */
const SEEDS: RefSecondaireSeed[] = [
  { code: 'CREATE', libelle: 'Création', ordre: 10, estSysteme: true },
  { code: 'UPDATE', libelle: 'Modification', ordre: 20, estSysteme: true },
  { code: 'DELETE', libelle: 'Suppression', ordre: 30, estSysteme: true },
  { code: 'IMPORT', libelle: 'Import', ordre: 40, estSysteme: true },
  { code: 'EXPORT', libelle: 'Export', ordre: 45, estSysteme: true },
  { code: 'LOGIN', libelle: 'Connexion', ordre: 50, estSysteme: true },
  {
    code: 'LOGIN_FAILED',
    libelle: 'Échec de connexion',
    ordre: 55,
    estSysteme: true,
  },
  { code: 'LOGOUT', libelle: 'Déconnexion', ordre: 60, estSysteme: true },
  {
    code: 'REFRESH',
    libelle: 'Rafraîchissement de jeton',
    ordre: 65,
    estSysteme: true,
  },
  {
    code: 'REFRESH_FORCED_REVOCATION',
    libelle: 'Révocation forcée de jeton',
    ordre: 67,
    estSysteme: true,
  },
  { code: 'VALIDATE', libelle: 'Validation', ordre: 70, estSysteme: true },
  { code: 'FREEZE', libelle: 'Gel', ordre: 80, estSysteme: true },
  {
    code: 'PERMISSION_DENIED',
    libelle: 'Permission refusée',
    ordre: 90,
    estSysteme: true,
  },
  {
    code: 'LIRE_AUDIT',
    libelle: "Consultation du journal d'audit",
    ordre: 95,
    estSysteme: true,
  },
];

export class CreateRefTypeActionAudit1779000000130 implements MigrationInterface {
  name = 'CreateRefTypeActionAudit1779000000130';

  public async up(q: QueryRunner): Promise<void> {
    await createRefSecondaireTable(q, TABLE);
    await seedRefSecondaire(q, TABLE, SEEDS);
  }

  public async down(q: QueryRunner): Promise<void> {
    await dropRefSecondaireTable(q, TABLE);
  }
}
