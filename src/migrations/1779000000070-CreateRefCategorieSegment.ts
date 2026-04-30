import { MigrationInterface, QueryRunner } from 'typeorm';

import {
  createRefSecondaireTable,
  dropRefSecondaireTable,
  type RefSecondaireSeed,
  seedRefSecondaire,
} from './_helpers/ref-secondaire-migration-helpers';

const TABLE = 'ref_categorie_segment';

const SEEDS: RefSecondaireSeed[] = [
  { code: 'particulier', libelle: 'Particulier', ordre: 10, estSysteme: false },
  {
    code: 'professionnel',
    libelle: 'Professionnel',
    description: 'Travailleurs indépendants, professions libérales.',
    ordre: 20,
    estSysteme: false,
  },
  {
    code: 'pme',
    libelle: 'PME',
    description: 'Petites et moyennes entreprises.',
    ordre: 30,
    estSysteme: false,
  },
  {
    code: 'grande_entreprise',
    libelle: 'Grande entreprise',
    ordre: 40,
    estSysteme: false,
  },
  {
    code: 'institutionnel',
    libelle: 'Institutionnel',
    description:
      'Banques, assurances, fonds — segment réglementaire structurant.',
    ordre: 50,
    estSysteme: true,
  },
  {
    code: 'secteur_public',
    libelle: 'Secteur public',
    description: 'État, collectivités, organismes publics.',
    ordre: 60,
    estSysteme: true,
  },
];

export class CreateRefCategorieSegment1779000000070 implements MigrationInterface {
  name = 'CreateRefCategorieSegment1779000000070';

  public async up(q: QueryRunner): Promise<void> {
    await createRefSecondaireTable(q, TABLE);
    await seedRefSecondaire(q, TABLE, SEEDS);
  }

  public async down(q: QueryRunner): Promise<void> {
    await dropRefSecondaireTable(q, TABLE);
  }
}
