import { MigrationInterface, QueryRunner } from 'typeorm';

import {
  seedRefSecondaire,
  type RefSecondaireSeed,
} from './_helpers/ref-secondaire-migration-helpers';

/**
 * Lot workflow par CR — Enrichit les statuts de version.
 *
 * `dim_version.statut` est contraint par une FK vers `ref_statut_version`
 * (cf. migration 1779100000090, pattern « ref secondaire ») — il n'y a
 * PLUS de CHECK inline. On ajoute donc 2 codes de référence :
 *   - pre_valide    : tous les CR attendus sont VALIDE (bascule auto).
 *   - soumis_comite : soumise au Comité par le Coordinateur.
 *
 * Cycle version cible :
 *   ouvert → pre_valide → soumis_comite → valide (approuvé Comité)
 *          → gele (publié / D12, inchangé).
 * (`soumis` legacy conservé : coexistence du workflow version-globale.)
 */
const TABLE = 'ref_statut_version';

const SEEDS: RefSecondaireSeed[] = [
  {
    code: 'pre_valide',
    libelle: 'Pré-validé',
    description:
      'Tous les CR attendus sont validés ; en attente de soumission au Comité par le Coordinateur.',
    ordre: 15,
    estSysteme: true,
  },
  {
    code: 'soumis_comite',
    libelle: 'Soumis au Comité',
    description:
      'Soumise au Comité budgétaire par le Coordinateur ; en attente d’approbation.',
    ordre: 25,
    estSysteme: true,
  },
];

export class EnrichirStatutsDimVersion1779200000490 implements MigrationInterface {
  name = 'EnrichirStatutsDimVersion1779200000490';

  public async up(q: QueryRunner): Promise<void> {
    await seedRefSecondaire(q, TABLE, SEEDS);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      `DELETE FROM "${TABLE}" WHERE "code" IN ('pre_valide','soumis_comite')`,
    );
  }
}
