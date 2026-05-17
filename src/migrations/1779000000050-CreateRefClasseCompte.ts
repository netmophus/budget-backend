import { MigrationInterface, QueryRunner } from 'typeorm';

import {
  createRefSecondaireTable,
  dropRefSecondaireTable,
  type RefSecondaireSeed,
  seedRefSecondaire,
} from './_helpers/ref-secondaire-migration-helpers';

const TABLE = 'ref_classe_compte';

/**
 * Classes du PCB UMOA Révisé (1 à 9, libellés conformes au plan
 * comptable bancaire). Toutes système — la classe est une donnée
 * structurelle du référentiel BCEAO.
 */
const SEEDS: RefSecondaireSeed[] = [
  {
    code: '1',
    libelle: 'Opérations de trésorerie et interbancaires',
    ordre: 10,
    estSysteme: true,
  },
  {
    code: '2',
    libelle: 'Opérations avec la clientèle',
    ordre: 20,
    estSysteme: true,
  },
  {
    code: '3',
    libelle: 'Opérations sur titres et opérations diverses',
    ordre: 30,
    estSysteme: true,
  },
  {
    code: '4',
    libelle: 'Valeurs immobilisées',
    ordre: 40,
    estSysteme: true,
  },
  {
    code: '5',
    libelle: 'Provisions, fonds propres et assimilés',
    ordre: 50,
    estSysteme: true,
  },
  {
    code: '6',
    libelle: 'Charges',
    ordre: 60,
    estSysteme: true,
  },
  {
    code: '7',
    libelle: 'Produits',
    ordre: 70,
    estSysteme: true,
  },
  {
    code: '8',
    libelle: 'Comptabilité analytique',
    ordre: 80,
    estSysteme: true,
  },
  {
    code: '9',
    libelle: 'Hors bilan',
    ordre: 90,
    estSysteme: true,
  },
];

export class CreateRefClasseCompte1779000000050 implements MigrationInterface {
  name = 'CreateRefClasseCompte1779000000050';

  public async up(q: QueryRunner): Promise<void> {
    await createRefSecondaireTable(q, TABLE);
    await seedRefSecondaire(q, TABLE, SEEDS);
  }

  public async down(q: QueryRunner): Promise<void> {
    await dropRefSecondaireTable(q, TABLE);
  }
}
