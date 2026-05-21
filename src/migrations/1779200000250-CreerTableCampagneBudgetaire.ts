import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lot 8.1.A — Création de la table `campagne_budgetaire`.
 *
 * Une campagne représente la digitalisation du processus budgétaire annuel
 * — du cadrage Holding jusqu'au gel BCEAO. Contient le Comité nominé,
 * le calendrier, les documents officiels et (au final) la version de
 * budget produite.
 *
 * **Découverte vs spec** : `fk_user_signataire_defaut` typé BIGINT
 * (pas UUID) pour matcher la PK réelle de `"user"` (= bigint identity,
 * pas uuid). La spec affirmait UUID — incorrect après vérification de
 * `src/users/entities/user.entity.ts`.
 */
export class CreerTableCampagneBudgetaire1779200000250 implements MigrationInterface {
  name = 'CreerTableCampagneBudgetaire1779200000250';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE campagne_budgetaire (
        id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        code                        VARCHAR(50) UNIQUE NOT NULL,
        exercice_fiscal             INTEGER NOT NULL UNIQUE,
        libelle                     VARCHAR(255) NOT NULL,
        statut                      VARCHAR(20) NOT NULL DEFAULT 'PARAMETRAGE',
        mode_visa_defaut            VARCHAR(20) NOT NULL DEFAULT 'PARALLELE',
        date_creation               TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        date_lancement              TIMESTAMP,
        date_fin                    TIMESTAMP,
        fk_user_signataire_defaut   BIGINT NOT NULL REFERENCES "user"(id),
        utilisateur_creation        VARCHAR(255) NOT NULL,
        utilisateur_modification    VARCHAR(255),
        date_modification           TIMESTAMP,
        CONSTRAINT ck_camp_statut CHECK (statut IN ('PARAMETRAGE','EN_COURS','TERMINEE','ARCHIVEE')),
        CONSTRAINT ck_camp_mode_visa CHECK (mode_visa_defaut IN ('PARALLELE','SEQUENTIEL'))
      );
    `);

    await queryRunner.query(
      `CREATE INDEX idx_camp_exercice ON campagne_budgetaire(exercice_fiscal);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_camp_statut ON campagne_budgetaire(statut);`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS campagne_budgetaire CASCADE;`,
    );
  }
}
