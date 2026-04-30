import type { QueryRunner } from 'typeorm';

/**
 * Helpers DRY pour les 13 migrations Lot 2.5-bis-B.
 * Pattern uniforme : DROP CHECK + ADD FOREIGN KEY (code).
 *
 * Le `consumerColumn` est le nom SQL de la colonne dans la dimension
 * (ex. 'type_structure'), `refTable` est la table de référentiel
 * cible (ex. 'ref_type_structure').
 */

interface DropCheckAndAddFkOptions {
  consumerTable: string;
  consumerColumn: string;
  refTable: string;
  /** Nom de la CHECK existante à supprimer (si présente). null = ne rien dropper. */
  checkConstraintName: string | null;
  /** Nom de la FK à créer. Par convention `fk_<consumer>_<column>`. */
  fkConstraintName?: string;
}

export async function dropCheckAndAddFk(
  q: QueryRunner,
  options: DropCheckAndAddFkOptions,
): Promise<void> {
  const fkName =
    options.fkConstraintName ??
    `fk_${options.consumerTable}_${options.consumerColumn}`;
  if (options.checkConstraintName) {
    await q.query(
      `ALTER TABLE "${options.consumerTable}" DROP CONSTRAINT IF EXISTS "${options.checkConstraintName}"`,
    );
  }
  await q.query(
    `ALTER TABLE "${options.consumerTable}"
       ADD CONSTRAINT "${fkName}"
       FOREIGN KEY ("${options.consumerColumn}")
       REFERENCES "${options.refTable}"("code")
       ON UPDATE CASCADE ON DELETE RESTRICT`,
  );
}

interface DownDropFkOptions {
  consumerTable: string;
  consumerColumn: string;
  /** SQL CHECK clause à recréer (sans le `CONSTRAINT name CHECK (...)`). */
  recreateCheckSql?: string;
  checkConstraintName?: string;
  fkConstraintName?: string;
}

export async function dropFkAndRestoreCheck(
  q: QueryRunner,
  options: DownDropFkOptions,
): Promise<void> {
  const fkName =
    options.fkConstraintName ??
    `fk_${options.consumerTable}_${options.consumerColumn}`;
  await q.query(
    `ALTER TABLE "${options.consumerTable}" DROP CONSTRAINT IF EXISTS "${fkName}"`,
  );
  if (options.recreateCheckSql && options.checkConstraintName) {
    await q.query(
      `ALTER TABLE "${options.consumerTable}"
         ADD CONSTRAINT "${options.checkConstraintName}"
         CHECK (${options.recreateCheckSql})`,
    );
  }
}
