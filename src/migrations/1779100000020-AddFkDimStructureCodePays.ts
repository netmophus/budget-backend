import { MigrationInterface, QueryRunner } from 'typeorm';

import {
  dropCheckAndAddFk,
  dropFkAndRestoreCheck,
} from './_helpers/fk-ref-secondaire-helpers';

const CHECK_NAME = 'ck_dim_structure_pays';
/**
 * La CHECK originale autorisait les 8 codes UEMOA + NULL. La FK
 * pointe sur ref_pays(code) qui contient ces 8 codes + 'autre'.
 * Restoration en down recrée la CHECK historique.
 */
const RECREATE_CHECK = `"code_pays" IS NULL OR "code_pays" IN ('BEN','BFA','CIV','GNB','MLI','NER','SEN','TGO')`;

export class AddFkDimStructureCodePays1779100000020
  implements MigrationInterface
{
  name = 'AddFkDimStructureCodePays1779100000020';

  public async up(q: QueryRunner): Promise<void> {
    await dropCheckAndAddFk(q, {
      consumerTable: 'dim_structure',
      consumerColumn: 'code_pays',
      refTable: 'ref_pays',
      checkConstraintName: CHECK_NAME,
    });
  }

  public async down(q: QueryRunner): Promise<void> {
    await dropFkAndRestoreCheck(q, {
      consumerTable: 'dim_structure',
      consumerColumn: 'code_pays',
      checkConstraintName: CHECK_NAME,
      recreateCheckSql: RECREATE_CHECK,
    });
  }
}
