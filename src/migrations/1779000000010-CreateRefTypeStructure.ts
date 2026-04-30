import { MigrationInterface, QueryRunner } from 'typeorm';

import {
  createRefSecondaireTable,
  dropRefSecondaireTable,
  type RefSecondaireSeed,
  seedRefSecondaire,
} from './_helpers/ref-secondaire-migration-helpers';

const TABLE = 'ref_type_structure';

const SEEDS: RefSecondaireSeed[] = [
  {
    code: 'entite_juridique',
    libelle: 'Entité juridique',
    description: 'Société mère ou filiale juridiquement distincte.',
    ordre: 10,
    estSysteme: true,
  },
  {
    code: 'branche',
    libelle: 'Branche',
    description: "Subdivision géographique ou métier directement sous l'entité.",
    ordre: 20,
    estSysteme: true,
  },
  {
    code: 'direction',
    libelle: 'Direction',
    description: 'Niveau directionnel (ex. retail, corporate).',
    ordre: 30,
    estSysteme: true,
  },
  {
    code: 'departement',
    libelle: 'Département',
    description: 'Subdivision opérationnelle dans une direction.',
    ordre: 40,
    estSysteme: true,
  },
  {
    code: 'agence',
    libelle: 'Agence',
    description: 'Point de vente / unité opérationnelle terrain.',
    ordre: 50,
    estSysteme: false,
  },
];

export class CreateRefTypeStructure1779000000010 implements MigrationInterface {
  name = 'CreateRefTypeStructure1779000000010';

  public async up(q: QueryRunner): Promise<void> {
    await createRefSecondaireTable(q, TABLE);
    await seedRefSecondaire(q, TABLE, SEEDS);
  }

  public async down(q: QueryRunner): Promise<void> {
    await dropRefSecondaireTable(q, TABLE);
  }
}
