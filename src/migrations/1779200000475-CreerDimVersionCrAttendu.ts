import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lot workflow par CR — Création de la table `dim_version_cr_attendu`.
 *
 * Snapshot FIGÉ des CR attendus d'une version (dénominateur du
 * compteur « X/Y CR validés » + condition de bascule PRE_VALIDE).
 * Peuplé au lancement = périmètres effectifs des SAISISSEUR actifs.
 * `actif = false` → CR retiré du snapshot par le Coordinateur (tracé).
 */
export class CreerDimVersionCrAttendu1779200000475 implements MigrationInterface {
  name = 'CreerDimVersionCrAttendu1779200000475';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE dim_version_cr_attendu (
        id                        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        fk_version                BIGINT NOT NULL REFERENCES dim_version(id),
        fk_cr                     BIGINT NOT NULL REFERENCES dim_centre_responsabilite(id),
        source                    VARCHAR(10) NOT NULL DEFAULT 'AUTO',
        actif                     BOOLEAN NOT NULL DEFAULT true,
        motif_retrait             TEXT,
        date_creation             TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        utilisateur_creation      VARCHAR(255) NOT NULL DEFAULT 'system',
        date_modification         TIMESTAMP,
        utilisateur_modification  VARCHAR(255),
        CONSTRAINT ck_dvca_source CHECK (source IN ('AUTO','MANUEL')),
        CONSTRAINT uq_dvca_version_cr UNIQUE (fk_version, fk_cr)
      );
    `);
    await queryRunner.query(
      `CREATE INDEX ix_dvca_version_actif ON dim_version_cr_attendu(fk_version, actif);`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS dim_version_cr_attendu CASCADE;`,
    );
  }
}
