import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lot 8.1.A — Création de la table `document_visa`.
 *
 * Snapshot du Comité visa sur un document, au moment de la soumission.
 * Cardinalité 1-N depuis `document_officiel`. Permet de conserver la
 * composition du Comité originel même si un membre démissionne en cours
 * de campagne (pratique bancaire courante : un document émis sous le
 * Comité C1 garde C1 dans son audit, même si C2 est nominé après).
 *
 * `fk_user_viseur` est BIGINT (PK de `"user"`).
 */
export class CreerTableDocumentVisa1779200000280 implements MigrationInterface {
  name = 'CreerTableDocumentVisa1779200000280';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE document_visa (
        id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        fk_document         UUID NOT NULL REFERENCES document_officiel(id) ON DELETE CASCADE,
        fk_user_viseur      BIGINT NOT NULL REFERENCES "user"(id),
        ordre_visa          INTEGER NOT NULL DEFAULT 1,
        est_obligatoire     BOOLEAN NOT NULL DEFAULT true,
        libelle_fonction    VARCHAR(255),
        statut              VARCHAR(20) NOT NULL DEFAULT 'EN_ATTENTE',
        date_demande        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        date_action         TIMESTAMP,
        commentaire         TEXT,
        CONSTRAINT ck_visa_statut CHECK (statut IN ('EN_ATTENTE','VISE','REJETE','IGNORE')),
        CONSTRAINT ck_visa_commentaire_si_rejet CHECK (
          (statut = 'REJETE' AND commentaire IS NOT NULL)
          OR (statut != 'REJETE')
        ),
        CONSTRAINT uq_visa_doc_user UNIQUE (fk_document, fk_user_viseur)
      );
    `);

    await queryRunner.query(
      `CREATE INDEX idx_visa_document ON document_visa(fk_document);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_visa_user ON document_visa(fk_user_viseur);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_visa_statut ON document_visa(statut);`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS document_visa CASCADE;`);
  }
}
