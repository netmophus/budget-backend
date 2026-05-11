import { MigrationInterface, QueryRunner } from 'typeorm';

import {
  createRefSecondaireTable,
  dropRefSecondaireTable,
  type RefSecondaireSeed,
  seedRefSecondaire,
} from './_helpers/ref-secondaire-migration-helpers';

const TABLE = 'ref_type_scenario';

const SEEDS: RefSecondaireSeed[] = [
  {
    code: 'central',
    libelle: 'Central',
    description:
      'Hypothèses macro de référence (taux directeur BCEAO, croissance UEMOA).',
    ordre: 10,
    estSysteme: true,
  },
  {
    code: 'optimiste',
    libelle: 'Optimiste',
    description: 'Croissance accélérée, baisse des taux.',
    ordre: 20,
    estSysteme: true,
  },
  {
    code: 'pessimiste',
    libelle: 'Pessimiste',
    description: 'Ralentissement, choc inflation.',
    ordre: 30,
    estSysteme: true,
  },
  {
    code: 'alternatif',
    libelle: 'Alternatif',
    description: 'Hypothèses alternatives non standardisées.',
    ordre: 40,
    estSysteme: true,
  },
];

export class CreateRefTypeScenario1779000000100 implements MigrationInterface {
  name = 'CreateRefTypeScenario1779000000100';

  public async up(q: QueryRunner): Promise<void> {
    await createRefSecondaireTable(q, TABLE);
    await seedRefSecondaire(q, TABLE, SEEDS);
  }

  public async down(q: QueryRunner): Promise<void> {
    await dropRefSecondaireTable(q, TABLE);
  }
}
