import { MigrationInterface, QueryRunner } from 'typeorm';

import {
  dropCheckAndAddFk,
  dropFkAndRestoreCheck,
} from './_helpers/fk-ref-secondaire-helpers';

const CHECK_NAME = 'ck_dim_version_type';
const RECREATE_CHECK = `"type_version" IN ('budget_initial','reforecast_1','reforecast_2','atterrissage')`;

export class AddFkDimVersionTypeVersion1779100000080
  implements MigrationInterface
{
  name = 'AddFkDimVersionTypeVersion1779100000080';

  public async up(q: QueryRunner): Promise<void> {
    await dropCheckAndAddFk(q, {
      consumerTable: 'dim_version',
      consumerColumn: 'type_version',
      refTable: 'ref_type_version',
      checkConstraintName: CHECK_NAME,
    });
  }

  public async down(q: QueryRunner): Promise<void> {
    await dropFkAndRestoreCheck(q, {
      consumerTable: 'dim_version',
      consumerColumn: 'type_version',
      checkConstraintName: CHECK_NAME,
      recreateCheckSql: RECREATE_CHECK,
    });
  }
}
