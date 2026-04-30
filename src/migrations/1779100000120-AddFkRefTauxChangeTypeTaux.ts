import { MigrationInterface, QueryRunner } from 'typeorm';

import {
  dropCheckAndAddFk,
  dropFkAndRestoreCheck,
} from './_helpers/fk-ref-secondaire-helpers';

const CHECK_NAME = 'ck_ref_taux_change_type';
const RECREATE_CHECK = `"type_taux" IN ('cloture','moyen_mensuel','fixe_budgetaire')`;

export class AddFkRefTauxChangeTypeTaux1779100000120
  implements MigrationInterface
{
  name = 'AddFkRefTauxChangeTypeTaux1779100000120';

  public async up(q: QueryRunner): Promise<void> {
    await dropCheckAndAddFk(q, {
      consumerTable: 'ref_taux_change',
      consumerColumn: 'type_taux',
      refTable: 'ref_type_taux',
      checkConstraintName: CHECK_NAME,
    });
  }

  public async down(q: QueryRunner): Promise<void> {
    await dropFkAndRestoreCheck(q, {
      consumerTable: 'ref_taux_change',
      consumerColumn: 'type_taux',
      checkConstraintName: CHECK_NAME,
      recreateCheckSql: RECREATE_CHECK,
    });
  }
}
