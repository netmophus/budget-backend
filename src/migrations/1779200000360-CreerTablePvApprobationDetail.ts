import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration Lot 8.3.D — table `pv_approbation_detail` (1-1 avec
 * `document_officiel` pour les documents de type D11_PV_APPROBATION).
 *
 * 5e type métier riche après D2 (Lot 8.2.C migration 320), D3
 * (Lot 8.3.A migration 330), D5 (Lot 8.3.B migration 340) et D1
 * (Lot 8.3.C migration 350). Numérotation 360 en séquence stricte.
 *
 * **Position dans le cycle BSIC** : le PV CA est émis APRÈS la
 * signature de D2 (Lettre de cadrage). C'est l'acte officiel par
 * lequel le Conseil d'Administration approuve formellement le
 * budget cadré par la DG.
 *
 * Cycle complet : **D1 (Note préparatoire DG) → D3 (Orientation
 * Comité) → D2 (Cadrage Directeurs CR) → D5 (Mobilisation tous
 * Directeurs) → D11 (PV d'approbation CA)**.
 *
 * Champs métier (12 champs + 4 techniques = 16 colonnes) :
 *  - Identification (numéro résolution + date séance + lieu)
 *  - Présidence (président + secrétaire de séance)
 *  - Quorum (présents + total + drapeau quorum atteint)
 *  - Ordre du jour (TipTap riche)
 *  - Décisions (TipTap riche)
 *  - Vote (résultat enum 3 valeurs + commentaire président)
 *
 * Choix techniques (cohérents Lots 8.2.C / 8.3.A / 8.3.B / 8.3.C) :
 *  - **Alignement sur D1 (Lot 8.3.C) plutôt que sur le brief 8.3.D**
 *    qui listait `BIGSERIAL/BIGINT/TIMESTAMPTZ` : le brief précise
 *    "à la moindre divergence, aligner sur le plus récent (D1)".
 *    Donc UUID + VARCHAR(255) email pour audit + TIMESTAMP plain,
 *    cohérent avec les 4 tables détail précédentes.
 *  - Tous les champs métier nullable (draft incomplet autorisé en
 *    BROUILLON)
 *  - 5 CHECK SQL conditionnels avec suffixe `_pv` (anti-collision)
 *  - **2e CHECK relationnel cross-fields du projet** après
 *    `ck_dates_preparation_coherentes` (D1) : `ck_quorum_coherent_pv`
 *    garantit `presents <= total` (NULL-friendly)
 *  - 3 index : `fk_document` (jointure 1-1), `date_seance_ca`
 *    (requêtes par séance), `numero_resolution` (recherche par n°)
 *  - Préfixe index `idx_pad_*` (PvApprobationDetail)
 *  - Extension `uuid-ossp` déjà activée (migration 1779200000245)
 */
export class CreerTablePvApprobationDetail1779200000360 implements MigrationInterface {
  name = 'CreerTablePvApprobationDetail1779200000360';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE pv_approbation_detail (
        id                              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        fk_document                     UUID NOT NULL UNIQUE REFERENCES document_officiel(id) ON DELETE CASCADE,
        numero_resolution               VARCHAR(50),
        date_seance_ca                  DATE,
        lieu_seance                     VARCHAR(255),
        president_seance                VARCHAR(255),
        secretaire_seance               VARCHAR(255),
        nb_administrateurs_presents     INTEGER,
        nb_administrateurs_total        INTEGER,
        quorum_atteint                  BOOLEAN,
        ordre_du_jour_html              TEXT,
        decisions_html                  TEXT,
        vote_resultat                   VARCHAR(50),
        commentaire_president           TEXT,
        date_creation                   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        date_modification               TIMESTAMP,
        utilisateur_creation            VARCHAR(255) NOT NULL,
        utilisateur_modification        VARCHAR(255),
        CONSTRAINT ck_nb_admin_presents_positif_pv CHECK (
          nb_administrateurs_presents IS NULL OR nb_administrateurs_presents >= 0
        ),
        CONSTRAINT ck_nb_admin_total_positif_pv CHECK (
          nb_administrateurs_total IS NULL OR nb_administrateurs_total > 0
        ),
        CONSTRAINT ck_quorum_coherent_pv CHECK (
          nb_administrateurs_presents IS NULL
          OR nb_administrateurs_total IS NULL
          OR nb_administrateurs_presents <= nb_administrateurs_total
        ),
        CONSTRAINT ck_vote_resultat_valide_pv CHECK (
          vote_resultat IS NULL OR vote_resultat IN ('UNANIMITE', 'MAJORITE', 'REJETE')
        ),
        CONSTRAINT ck_date_seance_plausible_pv CHECK (
          date_seance_ca IS NULL OR date_seance_ca BETWEEN DATE '2020-01-01' AND DATE '2050-12-31'
        )
      );
    `);
    await queryRunner.query(
      `CREATE INDEX idx_pad_fk_document ON pv_approbation_detail(fk_document);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_pad_date_seance ON pv_approbation_detail(date_seance_ca);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_pad_numero_resolution ON pv_approbation_detail(numero_resolution);`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS pv_approbation_detail CASCADE;`,
    );
  }
}
