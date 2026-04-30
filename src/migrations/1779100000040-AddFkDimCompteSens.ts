import { MigrationInterface, QueryRunner } from 'typeorm';

import {
  dropCheckAndAddFk,
  dropFkAndRestoreCheck,
} from './_helpers/fk-ref-secondaire-helpers';

const CHECK_NAME = 'ck_dim_compte_sens';
const RECREATE_CHECK = `"sens" IS NULL OR "sens" IN ('D','C','M')`;

export class AddFkDimCompteSens1779100000040 implements MigrationInterface {
  name = 'AddFkDimCompteSens1779100000040';

  public async up(q: QueryRunner): Promise<void> {
    await dropCheckAndAddFk(q, {
      consumerTable: 'dim_compte',
      consumerColumn: 'sens',
      refTable: 'ref_sens_compte',
      checkConstraintName: CHECK_NAME,
    });
  }

  public async down(q: QueryRunner): Promise<void> {
    await dropFkAndRestoreCheck(q, {
      consumerTable: 'dim_compte',
      consumerColumn: 'sens',
      checkConstraintName: CHECK_NAME,
      recreateCheckSql: RECREATE_CHECK,
    });
  }
}
