import { MigrationInterface, QueryRunner } from 'typeorm';

import {
  dropCheckAndAddFk,
  dropFkAndRestoreCheck,
} from './_helpers/fk-ref-secondaire-helpers';

const CHECK_NAME = 'ck_dim_scenario_type';
const RECREATE_CHECK = `"type_scenario" IN ('central','optimiste','pessimiste','alternatif')`;

export class AddFkDimScenarioTypeScenario1779100000100 implements MigrationInterface {
  name = 'AddFkDimScenarioTypeScenario1779100000100';

  public async up(q: QueryRunner): Promise<void> {
    await dropCheckAndAddFk(q, {
      consumerTable: 'dim_scenario',
      consumerColumn: 'type_scenario',
      refTable: 'ref_type_scenario',
      checkConstraintName: CHECK_NAME,
    });
  }

  public async down(q: QueryRunner): Promise<void> {
    await dropFkAndRestoreCheck(q, {
      consumerTable: 'dim_scenario',
      consumerColumn: 'type_scenario',
      checkConstraintName: CHECK_NAME,
      recreateCheckSql: RECREATE_CHECK,
    });
  }
}
