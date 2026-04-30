import { MigrationInterface, QueryRunner } from 'typeorm';

import {
  dropCheckAndAddFk,
  dropFkAndRestoreCheck,
} from './_helpers/fk-ref-secondaire-helpers';

/**
 * Pas de CHECK contrainte historique sur `audit_log.type_action`
 * (cf. migration 1777388323583-AddAuditLog.ts qui ne pose qu'un
 * `ck_audit_log_statut` sur la colonne statut). On ajoute juste la
 * FK ; pas de CHECK à supprimer ni à restaurer.
 */
export class AddFkAuditLogTypeAction1779100000130 implements MigrationInterface {
  name = 'AddFkAuditLogTypeAction1779100000130';

  public async up(q: QueryRunner): Promise<void> {
    await dropCheckAndAddFk(q, {
      consumerTable: 'audit_log',
      consumerColumn: 'type_action',
      refTable: 'ref_type_action_audit',
      checkConstraintName: null,
    });
  }

  public async down(q: QueryRunner): Promise<void> {
    await dropFkAndRestoreCheck(q, {
      consumerTable: 'audit_log',
      consumerColumn: 'type_action',
      // pas de CHECK à recréer
    });
  }
}
