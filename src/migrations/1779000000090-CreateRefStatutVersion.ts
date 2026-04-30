import { MigrationInterface, QueryRunner } from 'typeorm';

import {
  createRefSecondaireTable,
  dropRefSecondaireTable,
  type RefSecondaireSeed,
  seedRefSecondaire,
} from './_helpers/ref-secondaire-migration-helpers';

const TABLE = 'ref_statut_version';

/**
 * Statuts du workflow version (Lot 3.3) — toutes système car le code
 * applicatif s'appuie dessus pour l'orchestration.
 */
const SEEDS: RefSecondaireSeed[] = [
  {
    code: 'ouvert',
    libelle: 'Ouvert',
    description: "La saisie est autorisée tant que la version est dans cet état.",
    ordre: 10,
    estSysteme: true,
  },
  {
    code: 'soumis',
    libelle: 'Soumis',
    description: 'Soumise à validation hiérarchique.',
    ordre: 20,
    estSysteme: true,
  },
  {
    code: 'valide',
    libelle: 'Validé',
    description: 'Validée par la hiérarchie ; en attente de gel.',
    ordre: 30,
    estSysteme: true,
  },
  {
    code: 'gele',
    libelle: 'Gelé',
    description: 'Gelée — plus aucune mutation possible.',
    ordre: 40,
    estSysteme: true,
  },
];

export class CreateRefStatutVersion1779000000090 implements MigrationInterface {
  name = 'CreateRefStatutVersion1779000000090';

  public async up(q: QueryRunner): Promise<void> {
    await createRefSecondaireTable(q, TABLE);
    await seedRefSecondaire(q, TABLE, SEEDS);
  }

  public async down(q: QueryRunner): Promise<void> {
    await dropRefSecondaireTable(q, TABLE);
  }
}
