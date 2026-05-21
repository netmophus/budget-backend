import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lot 8.1.A — Création de la table `document_signature`.
 *
 * Une ligne unique par document signé (contrainte UNIQUE sur fk_document).
 * Capture l'empreinte cryptographique du contenu + des visas + le
 * contexte d'auth (IP, user-agent, méthode) au moment exact de la
 * signature. Lien vers audit_log pour traçabilité réglementaire BCEAO.
 *
 * `ON DELETE RESTRICT` côté fk_document : on ne peut PAS supprimer un
 * document signé (cohérent avec la conservation 10 ans).
 * `fk_user_signataire` = BIGINT (PK de `"user"`).
 * `fk_audit_log` = BIGINT (PK de `audit_log`).
 */
export class CreerTableDocumentSignature1779200000290 implements MigrationInterface {
  name = 'CreerTableDocumentSignature1779200000290';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE document_signature (
        id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        fk_document              UUID NOT NULL UNIQUE REFERENCES document_officiel(id) ON DELETE RESTRICT,
        fk_user_signataire       BIGINT NOT NULL REFERENCES "user"(id),
        email_signataire         VARCHAR(255) NOT NULL,
        nom_signataire           VARCHAR(255) NOT NULL,
        hash_contenu             VARCHAR(64) NOT NULL,
        hash_visas               VARCHAR(64) NOT NULL,
        ip_signature             VARCHAR(45),
        user_agent_signature     TEXT,
        methode_authentification VARCHAR(50) NOT NULL DEFAULT 'PASSWORD',
        date_signature           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        fk_audit_log             BIGINT REFERENCES audit_log(id)
      );
    `);

    await queryRunner.query(
      `CREATE INDEX idx_signature_user ON document_signature(fk_user_signataire);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_signature_audit ON document_signature(fk_audit_log);`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS document_signature CASCADE;`);
  }
}
