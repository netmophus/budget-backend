import { MigrationInterface, QueryRunner } from 'typeorm';

import {
  dropCheckAndAddFk,
  dropFkAndRestoreCheck,
} from './_helpers/fk-ref-secondaire-helpers';

const CHECK_NAME = 'ck_dim_segment_categorie';
const RECREATE_CHECK = `"categorie" IN ('particulier','professionnel','pme','grande_entreprise','institutionnel','secteur_public')`;

export class AddFkDimSegmentCategorie1779100000070
  implements MigrationInterface
{
  name = 'AddFkDimSegmentCategorie1779100000070';

  public async up(q: QueryRunner): Promise<void> {
    await dropCheckAndAddFk(q, {
      consumerTable: 'dim_segment',
      consumerColumn: 'categorie',
      refTable: 'ref_categorie_segment',
      checkConstraintName: CHECK_NAME,
    });
  }

  public async down(q: QueryRunner): Promise<void> {
    await dropFkAndRestoreCheck(q, {
      consumerTable: 'dim_segment',
      consumerColumn: 'categorie',
      checkConstraintName: CHECK_NAME,
      recreateCheckSql: RECREATE_CHECK,
    });
  }
}
