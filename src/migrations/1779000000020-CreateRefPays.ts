import { MigrationInterface, QueryRunner } from 'typeorm';

import {
  createRefSecondaireTable,
  dropRefSecondaireTable,
  type RefSecondaireSeed,
  seedRefSecondaire,
} from './_helpers/ref-secondaire-migration-helpers';

const TABLE = 'ref_pays';

const SEEDS: RefSecondaireSeed[] = [
  { code: 'BEN', libelle: 'Bénin', ordre: 10, estSysteme: false },
  { code: 'BFA', libelle: 'Burkina Faso', ordre: 20, estSysteme: false },
  { code: 'CIV', libelle: "Côte d'Ivoire", ordre: 30, estSysteme: false },
  { code: 'GNB', libelle: 'Guinée-Bissau', ordre: 40, estSysteme: false },
  { code: 'MLI', libelle: 'Mali', ordre: 50, estSysteme: false },
  { code: 'NER', libelle: 'Niger', ordre: 60, estSysteme: false },
  { code: 'SEN', libelle: 'Sénégal', ordre: 70, estSysteme: false },
  { code: 'TGO', libelle: 'Togo', ordre: 80, estSysteme: false },
  {
    code: 'autre',
    libelle: 'Autre',
    description:
      'Code de repli pour migrations historiques ou pays hors UEMOA.',
    ordre: 999,
    estSysteme: true,
  },
];

export class CreateRefPays1779000000020 implements MigrationInterface {
  name = 'CreateRefPays1779000000020';

  public async up(q: QueryRunner): Promise<void> {
    await createRefSecondaireTable(q, TABLE);
    await seedRefSecondaire(q, TABLE, SEEDS);
  }

  public async down(q: QueryRunner): Promise<void> {
    await dropRefSecondaireTable(q, TABLE);
  }
}
