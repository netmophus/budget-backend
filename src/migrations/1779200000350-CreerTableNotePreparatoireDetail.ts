import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration Lot 8.3.C — table `note_preparatoire_detail` (1-1 avec
 * `document_officiel` pour les documents de type D1_NOTE_PREPARATOIRE).
 *
 * 4e type métier riche après D2 (Lot 8.2.C migration 320), D3
 * (Lot 8.3.A migration 330) et D5 (Lot 8.3.B migration 340).
 * Numérotation 350 en séquence stricte.
 *
 * **Position dans le cycle BSIC** : la Note préparatoire DG est
 * émise par le DG AVANT la réunion du Comité, en début de cycle
 * budgétaire. Elle pose le contexte et l'ordre du jour de la
 * réunion qui donnera ensuite naissance à D3 Note d'orientation
 * puis à D2 Lettre de cadrage puis à D5 Lettre de mobilisation.
 *
 * Cycle complet : **D1 (Note préparatoire DG) → D3 (Orientation
 * Comité) → D2 (Cadrage Directeurs CR) → D5 (Mobilisation tous
 * Directeurs)**.
 *
 * Champs métier (7 sections de saisie) :
 *  - en-tête (référence + date émission + convocation Comité + lieu)
 *  - participants convoqués (texte multi-lignes max 2000 chars)
 *  - exercice budgétaire (exercice + dates début/butoir préparation)
 *  - ordre du jour (HTML riche TipTap, max 10 000 chars)
 *  - documents pré-lus attendus (texte multi-lignes max 2000 chars)
 *  - points clés à débattre (texte libre max 2000 chars)
 *  - décisions attendues (texte libre max 2000 chars)
 *
 * Choix techniques (cohérents Lots 8.2.C / 8.3.A / 8.3.B) :
 *  - Tous les champs métier nullable (draft incomplet autorisé en
 *    BROUILLON)
 *  - VARCHAR(2000) pour `participants_convoques` et `documents_pre_lus`
 *    (listes multi-lignes plus longues que les VARCHAR(1000) D5)
 *  - 2 CHECK SQL conditionnels avec suffixe `_np` (anti-collision)
 *  - **Nouveauté Lot 8.3.C** : `ck_dates_preparation_coherentes` =
 *    PREMIER CHECK relationnel cross-fields du projet (butoir >= début).
 *    Postgres NULL-friendly : `IS NULL OR X` court-circuite si NULL.
 *  - 3 index : `fk_document` (jointure 1-1), `exercice_concerne`
 *    (requêtes historiques), `date_convocation_comite` (recherches
 *    futures de réunions sur une période)
 *  - Extension `uuid-ossp` déjà activée (migration 1779200000245)
 */
export class CreerTableNotePreparatoireDetail1779200000350 implements MigrationInterface {
  name = 'CreerTableNotePreparatoireDetail1779200000350';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE note_preparatoire_detail (
        id                              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        fk_document                     UUID NOT NULL UNIQUE REFERENCES document_officiel(id) ON DELETE CASCADE,
        reference_note                  VARCHAR(100),
        date_emission                   DATE,
        date_convocation_comite         DATE,
        lieu_reunion                    VARCHAR(255),
        participants_convoques          VARCHAR(2000),
        exercice_concerne               INTEGER,
        date_debut_preparation          DATE,
        date_butoir_preparation         DATE,
        ordre_du_jour_html              TEXT,
        documents_pre_lus               VARCHAR(2000),
        points_cles_debattre            TEXT,
        decisions_attendues             TEXT,
        date_creation                   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        date_modification               TIMESTAMP,
        utilisateur_creation            VARCHAR(255) NOT NULL,
        utilisateur_modification        VARCHAR(255),
        CONSTRAINT ck_exercice_plausible_np CHECK (
          exercice_concerne IS NULL OR exercice_concerne BETWEEN 2020 AND 2050
        ),
        CONSTRAINT ck_dates_preparation_coherentes CHECK (
          date_debut_preparation IS NULL
          OR date_butoir_preparation IS NULL
          OR date_butoir_preparation >= date_debut_preparation
        )
      );
    `);
    await queryRunner.query(
      `CREATE INDEX idx_npd_fk_document ON note_preparatoire_detail(fk_document);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_npd_exercice ON note_preparatoire_detail(exercice_concerne);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_npd_convocation ON note_preparatoire_detail(date_convocation_comite);`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS note_preparatoire_detail CASCADE;`,
    );
  }
}
