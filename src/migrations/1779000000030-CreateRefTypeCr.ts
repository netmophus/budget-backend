import { MigrationInterface, QueryRunner } from 'typeorm';

import {
  createRefSecondaireTable,
  dropRefSecondaireTable,
  type RefSecondaireSeed,
  seedRefSecondaire,
} from './_helpers/ref-secondaire-migration-helpers';

const TABLE = 'ref_type_cr';

const SEEDS: RefSecondaireSeed[] = [
  {
    code: 'cdc',
    libelle: 'Centre de coût',
    description: 'CR sur lequel on contrôle uniquement les charges.',
    ordre: 10,
    estSysteme: true,
  },
  {
    code: 'cdp',
    libelle: 'Centre de profit',
    description: 'CR avec charges et produits, contribution mesurable.',
    ordre: 20,
    estSysteme: true,
  },
  {
    code: 'cdr',
    libelle: 'Centre de revenu',
    description: 'CR sur lequel on suit principalement les revenus.',
    ordre: 30,
    estSysteme: true,
  },
  {
    code: 'autre',
    libelle: 'Autre',
    description: 'CR sans typologie standard.',
    ordre: 99,
    estSysteme: true,
  },
];

export class CreateRefTypeCr1779000000030 implements MigrationInterface {
  name = 'CreateRefTypeCr1779000000030';

  public async up(q: QueryRunner): Promise<void> {
    await createRefSecondaireTable(q, TABLE);
    await seedRefSecondaire(q, TABLE, SEEDS);
  }

  public async down(q: QueryRunner): Promise<void> {
    await dropRefSecondaireTable(q, TABLE);
  }
}
