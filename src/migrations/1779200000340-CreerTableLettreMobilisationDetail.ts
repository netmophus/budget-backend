import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration Lot 8.3.B — table `lettre_mobilisation_detail` (1-1 avec
 * `document_officiel` pour les documents de type D5_LETTRE_MOBILISATION).
 *
 * 3e type métier riche après D2 (Lot 8.2.C migration 320) et D3
 * (Lot 8.3.A migration 330). Numérotation 340 pour cohérence.
 *
 * Affine le générique `document_officiel.contenu_html` avec les vrais
 * champs métier d'une Lettre de mobilisation DG → Directeurs BSIC :
 *  - en-tête lettre officielle (référence + date + destinataires
 *    multi-directions)
 *  - période d'exécution (exercice + plage de dates)
 *  - 4 objectifs globaux BSIC (PNB consolidé, RN consolidé,
 *    croissances crédits/dépôts)
 *  - 3 indicateurs de mobilisation (taux participation visé, nb
 *    objectifs prioritaires, taux conformité budgétaire)
 *  - 5 jalons échéances clés (réunion / saisie / 1er point / validation /
 *    BCEAO)
 *  - message DG (HTML riche TipTap, max 10 000 chars validé DTO)
 *  - engagement attendu (texte libre max 2 000 chars)
 *
 * Différence avec D2 (cadrage objectifs chiffrés) et D3 (note
 * stratégique amont) : D5 = lettre motivationnelle de mobilisation
 * APRÈS D2/D3, destinée aux Directeurs pour engager l'exécution.
 *
 * Choix techniques (cohérents Lots 8.2.C et 8.3.A) :
 *  - NUMERIC(15,2) pour montants M FCFA (PNB consolidé peut atteindre
 *    20 000 M FCFA), NUMERIC(5,2) pour pourcentages
 *  - VARCHAR(1000) pour `destinataires_directions` (liste longue)
 *  - Tous les champs métier nullable : draft incomplet autorisé en
 *    BROUILLON
 *  - 5 CHECK SQL conditionnels avec suffixe `_lm` (anti-collision noms)
 *  - 2 index : `fk_document` (jointure 1-1) + `exercice_concerne`
 *    pour futures requêtes historiques
 *  - Extension `uuid-ossp` déjà activée (migration 1779200000245)
 */
export class CreerTableLettreMobilisationDetail1779200000340 implements MigrationInterface {
  name = 'CreerTableLettreMobilisationDetail1779200000340';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE lettre_mobilisation_detail (
        id                              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        fk_document                     UUID NOT NULL UNIQUE REFERENCES document_officiel(id) ON DELETE CASCADE,
        reference_lettre                VARCHAR(100),
        date_emission                   DATE,
        destinataires_directions        VARCHAR(1000),
        exercice_concerne               INTEGER,
        date_debut_execution            DATE,
        date_fin_execution              DATE,
        pnb_consolide_mfcfa             NUMERIC(15,2),
        rn_consolide_mfcfa              NUMERIC(15,2),
        croissance_credits_globale_pct  NUMERIC(5,2),
        croissance_depots_globale_pct   NUMERIC(5,2),
        taux_participation_vise_pct     NUMERIC(5,2),
        nb_objectifs_prioritaires       INTEGER,
        taux_conformite_budgetaire_pct  NUMERIC(5,2),
        date_reunion_mobilisation       DATE,
        date_debut_saisie_objectifs     DATE,
        date_premier_point_avancement   DATE,
        date_validation_finale          DATE,
        date_communication_bceao        DATE,
        message_dg_html                 TEXT,
        engagement_attendu              TEXT,
        date_creation                   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        date_modification               TIMESTAMP,
        utilisateur_creation            VARCHAR(255) NOT NULL,
        utilisateur_modification        VARCHAR(255),
        CONSTRAINT ck_exercice_plausible_lm CHECK (
          exercice_concerne IS NULL OR exercice_concerne BETWEEN 2020 AND 2050
        ),
        CONSTRAINT ck_pnb_consolide_positif CHECK (
          pnb_consolide_mfcfa IS NULL OR pnb_consolide_mfcfa >= 0
        ),
        CONSTRAINT ck_rn_consolide_positif CHECK (
          rn_consolide_mfcfa IS NULL OR rn_consolide_mfcfa >= 0
        ),
        CONSTRAINT ck_croissances_lm_plausibles CHECK (
          (croissance_credits_globale_pct IS NULL OR croissance_credits_globale_pct BETWEEN -100 AND 200)
          AND (croissance_depots_globale_pct IS NULL OR croissance_depots_globale_pct BETWEEN -100 AND 200)
        ),
        CONSTRAINT ck_taux_mobilisation_plausibles CHECK (
          (taux_participation_vise_pct IS NULL OR taux_participation_vise_pct BETWEEN 0 AND 100)
          AND (taux_conformite_budgetaire_pct IS NULL OR taux_conformite_budgetaire_pct BETWEEN 0 AND 100)
        ),
        CONSTRAINT ck_nb_objectifs_positif CHECK (
          nb_objectifs_prioritaires IS NULL OR nb_objectifs_prioritaires >= 0
        )
      );
    `);
    await queryRunner.query(
      `CREATE INDEX idx_lmd_fk_document ON lettre_mobilisation_detail(fk_document);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_lmd_exercice ON lettre_mobilisation_detail(exercice_concerne);`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS lettre_mobilisation_detail CASCADE;`,
    );
  }
}
