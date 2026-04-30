import { MigrationInterface, QueryRunner } from 'typeorm';

import {
  dropCheckAndAddFk,
  dropFkAndRestoreCheck,
} from './_helpers/fk-ref-secondaire-helpers';

const CHECK_NAME = 'ck_dim_version_statut';
const RECREATE_CHECK = `"statut" IN ('ouvert','soumis','valide','gele')`;

export class AddFkDimVersionStatut1779100000090 implements MigrationInterface {
  name = 'AddFkDimVersionStatut1779100000090';

  public async up(q: QueryRunner): Promise<void> {
    await dropCheckAndAddFk(q, {
      consumerTable: 'dim_version',
      consumerColumn: 'statut',
      refTable: 'ref_statut_version',
      checkConstraintName: CHECK_NAME,
      fkConstraintName: 'fk_dim_version_statut',
    });
  }

  public async down(q: QueryRunner): Promise<void> {
    await dropFkAndRestoreCheck(q, {
      consumerTable: 'dim_version',
      consumerColumn: 'statut',
      checkConstraintName: CHECK_NAME,
      recreateCheckSql: RECREATE_CHECK,
      fkConstraintName: 'fk_dim_version_statut',
    });
  }
}
