import { MigrationInterface, QueryRunner } from 'typeorm';

import {
  createRefSecondaireTable,
  dropRefSecondaireTable,
  type RefSecondaireSeed,
  seedRefSecondaire,
} from './_helpers/ref-secondaire-migration-helpers';

const TABLE = 'ref_type_taux';

const SEEDS: RefSecondaireSeed[] = [
  {
    code: 'cloture',
    libelle: 'Clôture',
    description:
      'Taux fin de période, utilisé pour reforecast / atterrissage.',
    ordre: 10,
    estSysteme: true,
  },
  {
    code: 'moyen_mensuel',
    libelle: 'Moyen mensuel',
    description: 'Moyenne arithmétique des taux journaliers du mois.',
    ordre: 20,
    estSysteme: true,
  },
  {
    code: 'fixe_budgetaire',
    libelle: 'Fixe budgétaire',
    description:
      'Taux figé en début de cycle pour la version budget_initial.',
    ordre: 30,
    estSysteme: true,
  },
];

export class CreateRefTypeTaux1779000000120 implements MigrationInterface {
  name = 'CreateRefTypeTaux1779000000120';

  public async up(q: QueryRunner): Promise<void> {
    await createRefSecondaireTable(q, TABLE);
    await seedRefSecondaire(q, TABLE, SEEDS);
  }

  public async down(q: QueryRunner): Promise<void> {
    await dropRefSecondaireTable(q, TABLE);
  }
}
