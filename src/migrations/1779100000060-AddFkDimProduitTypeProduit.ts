import { MigrationInterface, QueryRunner } from 'typeorm';

import {
  dropCheckAndAddFk,
  dropFkAndRestoreCheck,
} from './_helpers/fk-ref-secondaire-helpers';

const CHECK_NAME = 'ck_dim_produit_type';
const RECREATE_CHECK = `"type_produit" IN ('credit','depot','service','marche','autre')`;

export class AddFkDimProduitTypeProduit1779100000060
  implements MigrationInterface
{
  name = 'AddFkDimProduitTypeProduit1779100000060';

  public async up(q: QueryRunner): Promise<void> {
    await dropCheckAndAddFk(q, {
      consumerTable: 'dim_produit',
      consumerColumn: 'type_produit',
      refTable: 'ref_type_produit',
      checkConstraintName: CHECK_NAME,
    });
  }

  public async down(q: QueryRunner): Promise<void> {
    await dropFkAndRestoreCheck(q, {
      consumerTable: 'dim_produit',
      consumerColumn: 'type_produit',
      checkConstraintName: CHECK_NAME,
      recreateCheckSql: RECREATE_CHECK,
    });
  }
}
