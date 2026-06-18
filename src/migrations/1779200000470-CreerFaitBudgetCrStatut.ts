import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lot workflow par CR — Création de la table `fait_budget_cr_statut`.
 *
 * Statut de cycle saisie/validation par (version × CR) :
 * EN_SAISIE → SOUMIS → VALIDE (rejet/réouverture ramènent à EN_SAISIE).
 *
 * FK BIGINT (dim_version.id, dim_centre_responsabilite.id, "user".id
 * sont des bigint identity). PK UUID (extension uuid-ossp active,
 * cf. migration 245).
 */
export class CreerFaitBudgetCrStatut1779200000470 implements MigrationInterface {
  name = 'CreerFaitBudgetCrStatut1779200000470';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE fait_budget_cr_statut (
        id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        fk_version          BIGINT NOT NULL REFERENCES dim_version(id),
        fk_cr               BIGINT NOT NULL REFERENCES dim_centre_responsabilite(id),
        statut              VARCHAR(20) NOT NULL DEFAULT 'EN_SAISIE',
        date_soumission     TIMESTAMP,
        date_validation     TIMESTAMP,
        date_reouverture    TIMESTAMP,
        fk_saisisseur       BIGINT REFERENCES "user"(id),
        fk_validateur       BIGINT REFERENCES "user"(id),
        motif_rejet         TEXT,
        motif_reouverture   TEXT,
        date_creation       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        date_modification   TIMESTAMP,
        fk_user_modif       BIGINT REFERENCES "user"(id),
        CONSTRAINT ck_fbcs_statut CHECK (statut IN ('EN_SAISIE','SOUMIS','VALIDE')),
        CONSTRAINT uq_fbcs_version_cr UNIQUE (fk_version, fk_cr)
      );
    `);
    await queryRunner.query(
      `CREATE INDEX ix_fbcs_version_statut ON fait_budget_cr_statut(fk_version, statut);`,
    );
    await queryRunner.query(
      `CREATE INDEX ix_fbcs_cr ON fait_budget_cr_statut(fk_cr);`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS fait_budget_cr_statut CASCADE;`,
    );
  }
}
