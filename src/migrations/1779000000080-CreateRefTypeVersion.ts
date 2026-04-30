import { MigrationInterface, QueryRunner } from 'typeorm';

import {
  createRefSecondaireTable,
  dropRefSecondaireTable,
  type RefSecondaireSeed,
  seedRefSecondaire,
} from './_helpers/ref-secondaire-migration-helpers';

const TABLE = 'ref_type_version';

const SEEDS: RefSecondaireSeed[] = [
  {
    code: 'budget_initial',
    libelle: 'Budget initial',
    description: 'Cadrage initial DG en début de cycle budgétaire.',
    ordre: 10,
    estSysteme: true,
  },
  {
    code: 'reforecast_1',
    libelle: 'Reforecast 1',
    description: 'Première reprévision de l\'exercice (typiquement Q2).',
    ordre: 20,
    estSysteme: true,
  },
  {
    code: 'reforecast_2',
    libelle: 'Reforecast 2',
    description: 'Seconde reprévision de l\'exercice (typiquement Q3).',
    ordre: 30,
    estSysteme: true,
  },
  {
    code: 'atterrissage',
    libelle: 'Atterrissage',
    description: 'Projection de fin d\'année (Q4).',
    ordre: 40,
    estSysteme: true,
  },
];

export class CreateRefTypeVersion1779000000080 implements MigrationInterface {
  name = 'CreateRefTypeVersion1779000000080';

  public async up(q: QueryRunner): Promise<void> {
    await createRefSecondaireTable(q, TABLE);
    await seedRefSecondaire(q, TABLE, SEEDS);
  }

  public async down(q: QueryRunner): Promise<void> {
    await dropRefSecondaireTable(q, TABLE);
  }
}
