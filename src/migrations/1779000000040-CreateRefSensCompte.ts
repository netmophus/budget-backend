import { MigrationInterface, QueryRunner } from 'typeorm';

import {
  createRefSecondaireTable,
  dropRefSecondaireTable,
  type RefSecondaireSeed,
  seedRefSecondaire,
} from './_helpers/ref-secondaire-migration-helpers';

const TABLE = 'ref_sens_compte';

const SEEDS: RefSecondaireSeed[] = [
  {
    code: 'D',
    libelle: 'Débit',
    description: 'Compte normalement débiteur (charges, actifs).',
    ordre: 10,
    estSysteme: true,
  },
  {
    code: 'C',
    libelle: 'Crédit',
    description: 'Compte normalement créditeur (produits, passifs).',
    ordre: 20,
    estSysteme: true,
  },
  {
    code: 'M',
    libelle: 'Mixte',
    description: 'Compte pouvant être débiteur ou créditeur selon le contexte.',
    ordre: 30,
    estSysteme: true,
  },
];

export class CreateRefSensCompte1779000000040 implements MigrationInterface {
  name = 'CreateRefSensCompte1779000000040';

  public async up(q: QueryRunner): Promise<void> {
    await createRefSecondaireTable(q, TABLE);
    await seedRefSecondaire(q, TABLE, SEEDS);
  }

  public async down(q: QueryRunner): Promise<void> {
    await dropRefSecondaireTable(q, TABLE);
  }
}
