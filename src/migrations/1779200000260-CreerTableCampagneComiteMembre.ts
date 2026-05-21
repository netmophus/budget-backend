import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lot 8.1.A — Création de la table `campagne_comite_membre`.
 *
 * Comité d'une campagne (= membres nominés par le DG pour viser les
 * documents officiels). Cardinalité 1-N depuis `campagne_budgetaire`.
 *
 * `fk_user` est BIGINT (PK de `"user"`).
 */
export class CreerTableCampagneComiteMembre1779200000260 implements MigrationInterface {
  name = 'CreerTableCampagneComiteMembre1779200000260';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE campagne_comite_membre (
        id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        fk_campagne           UUID NOT NULL REFERENCES campagne_budgetaire(id) ON DELETE CASCADE,
        fk_user               BIGINT NOT NULL REFERENCES "user"(id),
        ordre                 INTEGER NOT NULL DEFAULT 1,
        est_obligatoire       BOOLEAN NOT NULL DEFAULT true,
        libelle_fonction      VARCHAR(255),
        date_creation         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        utilisateur_creation  VARCHAR(255) NOT NULL,
        CONSTRAINT uq_camp_user UNIQUE (fk_campagne, fk_user)
      );
    `);

    await queryRunner.query(
      `CREATE INDEX idx_comite_campagne ON campagne_comite_membre(fk_campagne);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_comite_user ON campagne_comite_membre(fk_user);`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS campagne_comite_membre CASCADE;`,
    );
  }
}
