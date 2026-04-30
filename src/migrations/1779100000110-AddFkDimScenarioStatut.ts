import { MigrationInterface, QueryRunner } from 'typeorm';

import {
  dropCheckAndAddFk,
  dropFkAndRestoreCheck,
} from './_helpers/fk-ref-secondaire-helpers';

const CHECK_NAME = 'ck_dim_scenario_statut';
const RECREATE_CHECK = `"statut" IN ('actif','archive')`;

export class AddFkDimScenarioStatut1779100000110 implements MigrationInterface {
  name = 'AddFkDimScenarioStatut1779100000110';

  public async up(q: QueryRunner): Promise<void> {
    await dropCheckAndAddFk(q, {
      consumerTable: 'dim_scenario',
      consumerColumn: 'statut',
      refTable: 'ref_statut_scenario',
      checkConstraintName: CHECK_NAME,
      fkConstraintName: 'fk_dim_scenario_statut',
    });
  }

  public async down(q: QueryRunner): Promise<void> {
    await dropFkAndRestoreCheck(q, {
      consumerTable: 'dim_scenario',
      consumerColumn: 'statut',
      checkConstraintName: CHECK_NAME,
      recreateCheckSql: RECREATE_CHECK,
      fkConstraintName: 'fk_dim_scenario_statut',
    });
  }
}
