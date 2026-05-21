import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lot 8.1.A — Création de la table `document_officiel`.
 *
 * Table principale du workflow signature. Chaque document = 1 lettre/note
 * officielle dans le cadre d'une campagne (Lettre cadrage, Note orientation,
 * Lettre DG, etc.). Cycle de vie : BROUILLON → SOUMIS_VISA → VISE → SIGNE
 * → ARCHIVE.
 *
 * **Découvertes vs spec** :
 *  - `fk_user_emetteur`, `fk_user_signataire` : BIGINT (pas UUID)
 *  - `fk_version_budget` : BIGINT (pas INTEGER — la PK de dim_version est
 *    bigint identity, cf. `dim-version.entity.ts:39`)
 */
export class CreerTableDocumentOfficiel1779200000270 implements MigrationInterface {
  name = 'CreerTableDocumentOfficiel1779200000270';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE document_officiel (
        id                        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        code_document             VARCHAR(50) UNIQUE NOT NULL,
        type_document             VARCHAR(50) NOT NULL,
        fk_campagne               UUID REFERENCES campagne_budgetaire(id),
        titre                     VARCHAR(255) NOT NULL,
        contenu_html              TEXT NOT NULL,
        contenu_json              JSONB,
        reference_externe         VARCHAR(100),
        statut                    VARCHAR(20) NOT NULL DEFAULT 'BROUILLON',
        fk_user_emetteur          BIGINT NOT NULL REFERENCES "user"(id),
        fk_user_signataire        BIGINT NOT NULL REFERENCES "user"(id),
        fk_version_budget         BIGINT REFERENCES dim_version(id),
        date_creation             TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        date_modification         TIMESTAMP,
        date_soumission_visa      TIMESTAMP,
        date_visa_complet         TIMESTAMP,
        date_signature            TIMESTAMP,
        date_archivage            TIMESTAMP,
        hash_contenu_signe        VARCHAR(64),
        fichier_joint_path        VARCHAR(500),
        fichier_joint_nom         VARCHAR(255),
        utilisateur_creation      VARCHAR(255) NOT NULL,
        utilisateur_modification  VARCHAR(255),
        CONSTRAINT ck_doc_statut CHECK (statut IN ('BROUILLON','SOUMIS_VISA','VISE','SIGNE','ARCHIVE')),
        CONSTRAINT ck_doc_hash_si_signe CHECK (
          (statut IN ('SIGNE','ARCHIVE') AND hash_contenu_signe IS NOT NULL)
          OR (statut NOT IN ('SIGNE','ARCHIVE'))
        )
      );
    `);

    await queryRunner.query(
      `CREATE INDEX idx_doc_type ON document_officiel(type_document);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_doc_statut ON document_officiel(statut);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_doc_campagne ON document_officiel(fk_campagne);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_doc_emetteur ON document_officiel(fk_user_emetteur);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_doc_signataire ON document_officiel(fk_user_signataire);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_doc_version_budget ON document_officiel(fk_version_budget);`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS document_officiel CASCADE;`);
  }
}
