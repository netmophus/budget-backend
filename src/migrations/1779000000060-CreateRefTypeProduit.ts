import { MigrationInterface, QueryRunner } from 'typeorm';

import {
  createRefSecondaireTable,
  dropRefSecondaireTable,
  type RefSecondaireSeed,
  seedRefSecondaire,
} from './_helpers/ref-secondaire-migration-helpers';

const TABLE = 'ref_type_produit';

const SEEDS: RefSecondaireSeed[] = [
  {
    code: 'credit',
    libelle: 'Crédit',
    description: 'Produits de financement (prêts, lignes de crédit, etc.).',
    ordre: 10,
    estSysteme: true,
  },
  {
    code: 'depot',
    libelle: 'Dépôt',
    description: "Produits de collecte de l'épargne.",
    ordre: 20,
    estSysteme: true,
  },
  {
    code: 'service',
    libelle: 'Service',
    description: 'Services bancaires (commissions, conseil, etc.).',
    ordre: 30,
    estSysteme: true,
  },
  {
    code: 'marche',
    libelle: 'Marché',
    description: 'Activités de marché (titres, change, etc.).',
    ordre: 40,
    estSysteme: true,
  },
  {
    code: 'autre',
    libelle: 'Autre',
    ordre: 99,
    estSysteme: false,
  },
];

export class CreateRefTypeProduit1779000000060 implements MigrationInterface {
  name = 'CreateRefTypeProduit1779000000060';

  public async up(q: QueryRunner): Promise<void> {
    await createRefSecondaireTable(q, TABLE);
    await seedRefSecondaire(q, TABLE, SEEDS);
  }

  public async down(q: QueryRunner): Promise<void> {
    await dropRefSecondaireTable(q, TABLE);
  }
}
