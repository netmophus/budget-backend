import { MigrationInterface, QueryRunner } from 'typeorm';

import {
  dropCheckAndAddFk,
  dropFkAndRestoreCheck,
} from './_helpers/fk-ref-secondaire-helpers';

const CHECK_NAME = 'ck_dim_structure_type';
const RECREATE_CHECK = `"type_structure" IN ('entite_juridique','branche','direction','departement','agence')`;

export class AddFkDimStructureTypeStructure1779100000010
  implements MigrationInterface
{
  name = 'AddFkDimStructureTypeStructure1779100000010';

  public async up(q: QueryRunner): Promise<void> {
    await dropCheckAndAddFk(q, {
      consumerTable: 'dim_structure',
      consumerColumn: 'type_structure',
      refTable: 'ref_type_structure',
      checkConstraintName: CHECK_NAME,
    });
  }

  public async down(q: QueryRunner): Promise<void> {
    await dropFkAndRestoreCheck(q, {
      consumerTable: 'dim_structure',
      consumerColumn: 'type_structure',
      checkConstraintName: CHECK_NAME,
      recreateCheckSql: RECREATE_CHECK,
    });
  }
}
