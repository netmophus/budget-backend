import { MigrationInterface, QueryRunner } from 'typeorm';

import {
  dropCheckAndAddFk,
  dropFkAndRestoreCheck,
} from './_helpers/fk-ref-secondaire-helpers';

const CHECK_NAME = 'ck_dim_cr_type_cr';
const RECREATE_CHECK = `"type_cr" IN ('cdc','cdp','cdr','autre')`;

export class AddFkDimCrTypeCr1779100000030 implements MigrationInterface {
  name = 'AddFkDimCrTypeCr1779100000030';

  public async up(q: QueryRunner): Promise<void> {
    await dropCheckAndAddFk(q, {
      consumerTable: 'dim_centre_responsabilite',
      consumerColumn: 'type_cr',
      refTable: 'ref_type_cr',
      checkConstraintName: CHECK_NAME,
    });
  }

  public async down(q: QueryRunner): Promise<void> {
    await dropFkAndRestoreCheck(q, {
      consumerTable: 'dim_centre_responsabilite',
      consumerColumn: 'type_cr',
      checkConstraintName: CHECK_NAME,
      recreateCheckSql: RECREATE_CHECK,
    });
  }
}
