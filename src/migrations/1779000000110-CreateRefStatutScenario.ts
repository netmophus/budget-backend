import { MigrationInterface, QueryRunner } from 'typeorm';

import {
  createRefSecondaireTable,
  dropRefSecondaireTable,
  type RefSecondaireSeed,
  seedRefSecondaire,
} from './_helpers/ref-secondaire-migration-helpers';

const TABLE = 'ref_statut_scenario';

const SEEDS: RefSecondaireSeed[] = [
  {
    code: 'actif',
    libelle: 'Actif',
    description: 'Scénario disponible pour les nouvelles saisies.',
    ordre: 10,
    estSysteme: true,
  },
  {
    code: 'archive',
    libelle: 'Archivé',
    description: 'Scénario archivé — plus aucune nouvelle saisie possible.',
    ordre: 20,
    estSysteme: true,
  },
];

export class CreateRefStatutScenario1779000000110 implements MigrationInterface {
  name = 'CreateRefStatutScenario1779000000110';

  public async up(q: QueryRunner): Promise<void> {
    await createRefSecondaireTable(q, TABLE);
    await seedRefSecondaire(q, TABLE, SEEDS);
  }

  public async down(q: QueryRunner): Promise<void> {
    await dropRefSecondaireTable(q, TABLE);
  }
}
