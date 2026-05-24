import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration Lot 8.3.A — table `note_orientation_detail` (1-1 avec
 * `document_officiel` pour les documents de type D3_NOTE_ORIENTATION).
 *
 * Affine le générique `document_officiel.contenu_html` avec les vrais
 * champs métier d'une Note d'orientation interne BSIC :
 *  - en-tête note interne (numéro + date + émetteur/destinataire)
 *  - période d'application (exercice + plage de dates)
 *  - 5 hypothèses macroéconomiques (taux BCEAO, inflation, PIB, change, pétrole)
 *  - positionnement marché (parts actuelle/cible + concurrents + avantages)
 *  - 4 axes stratégiques prioritaires
 *  - description détaillée (HTML riche TipTap, max 10 000 chars)
 *  - recommandations (texte libre, max 2 000 chars)
 *
 * Différence métier D2 (Lot 8.2.C) vs D3 :
 *   D2 = Lettre de cadrage (externe, objectifs chiffrés)
 *   D3 = Note d'orientation (interne, analyse + axes amont du cadrage)
 *
 * Choix techniques (cohérents Lot 8.2.C) :
 *  - NUMERIC(5,2) pour pourcentages, NUMERIC(8,2) pour taux change /
 *    cours pétrole (jusqu'à 999 999.99)
 *  - Tous les champs métier nullable : draft incomplet autorisé en
 *    BROUILLON (cf. décision architecturale Lot 8.2.C P1)
 *  - ON DELETE CASCADE pour cohérence avec le document parent
 *  - Extension `uuid-ossp` déjà activée par migration 1779200000245
 *  - 6 CHECK SQL conditionnels (`IS NULL OR ...`) pour les plages
 *    plausibles : exercice 2020-2050, taux BCEAO 0-30, inflation
 *    -10 à 100, croissance -50 à 50, parts marché 0-100, montants ≥ 0
 *  - 2 index : `fk_document` (jointure 1-1) + `exercice_concerne`
 *    pour futures requêtes historiques par exercice
 */
export class CreerTableNoteOrientationDetail1779200000330 implements MigrationInterface {
  name = 'CreerTableNoteOrientationDetail1779200000330';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE note_orientation_detail (
        id                              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        fk_document                     UUID NOT NULL UNIQUE REFERENCES document_officiel(id) ON DELETE CASCADE,
        numero_note                     VARCHAR(100),
        date_emission                   DATE,
        emetteur_direction              VARCHAR(255),
        destinataire                    VARCHAR(255),
        exercice_concerne               INTEGER,
        date_debut_application          DATE,
        date_fin_application            DATE,
        taux_directeur_bceao_pct        NUMERIC(5,2),
        inflation_niger_pct             NUMERIC(5,2),
        croissance_pib_niger_pct        NUMERIC(5,2),
        taux_change_usd_fcfa            NUMERIC(8,2),
        cours_petrole_usd               NUMERIC(8,2),
        part_marche_actuelle_pct        NUMERIC(5,2),
        part_marche_cible_pct           NUMERIC(5,2),
        principaux_concurrents          VARCHAR(500),
        avantages_competitifs           VARCHAR(500),
        axe_digitalisation              VARCHAR(500),
        axe_developpement_pme           VARCHAR(500),
        axe_inclusion_financiere        VARCHAR(500),
        axe_autres_priorites            VARCHAR(500),
        description_detaillee_html      TEXT,
        recommandations                 TEXT,
        date_creation                   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        date_modification               TIMESTAMP,
        utilisateur_creation            VARCHAR(255) NOT NULL,
        utilisateur_modification        VARCHAR(255),
        CONSTRAINT ck_exercice_plausible CHECK (
          exercice_concerne IS NULL OR exercice_concerne BETWEEN 2020 AND 2050
        ),
        CONSTRAINT ck_taux_directeur_plausible CHECK (
          taux_directeur_bceao_pct IS NULL OR taux_directeur_bceao_pct BETWEEN 0 AND 30
        ),
        CONSTRAINT ck_inflation_plausible CHECK (
          inflation_niger_pct IS NULL OR inflation_niger_pct BETWEEN -10 AND 100
        ),
        CONSTRAINT ck_croissance_plausible CHECK (
          croissance_pib_niger_pct IS NULL OR croissance_pib_niger_pct BETWEEN -50 AND 50
        ),
        CONSTRAINT ck_taux_change_positif CHECK (
          taux_change_usd_fcfa IS NULL OR taux_change_usd_fcfa >= 0
        ),
        CONSTRAINT ck_cours_petrole_positif CHECK (
          cours_petrole_usd IS NULL OR cours_petrole_usd >= 0
        ),
        CONSTRAINT ck_parts_marche_plausibles CHECK (
          (part_marche_actuelle_pct IS NULL OR part_marche_actuelle_pct BETWEEN 0 AND 100)
          AND (part_marche_cible_pct IS NULL OR part_marche_cible_pct BETWEEN 0 AND 100)
        )
      );
    `);
    await queryRunner.query(
      `CREATE INDEX idx_nod_fk_document ON note_orientation_detail(fk_document);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_nod_exercice ON note_orientation_detail(exercice_concerne);`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS note_orientation_detail CASCADE;`,
    );
  }
}
