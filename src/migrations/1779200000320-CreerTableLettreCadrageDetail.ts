import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration Lot 8.2.C — table `lettre_cadrage_detail` (1-1 avec
 * `document_officiel` pour les documents de type D2_LETTRE_CADRAGE).
 *
 * Affine le générique `document_officiel.contenu_html` avec les vrais
 * champs métier d'une lettre de cadrage BSIC :
 *  - en-tête Holding (référence + signataire)
 *  - 6 objectifs quantitatifs (PNB / RN / croissances / coefficient / ROE)
 *  - 3 ratios prudentiels BCEAO obligatoires
 *  - 5 jalons calendrier budgétaire
 *  - orientations stratégiques (texte libre)
 *
 * Bénéfices :
 *  - Demo réaliste pour direction BSIC
 *  - Données queryables (rapports historiques "Évolution PNB cible
 *    2024-2028")
 *  - Vue formatée type lettre officielle imprimable
 *
 * Choix techniques :
 *  - NUMERIC(15,2) pour montants M FCFA (PNB BSIC ~ 12-15 milliards
 *    = 12 000-15 000 M FCFA, large marge).
 *  - NUMERIC(5,2) pour pourcentages (-99,99 à 999,99 — plages
 *    plausibles couvertes par CHECK ck_ratios_dans_plage).
 *  - Tous les champs métier nullable : le DG sauvegarde des drafts
 *    incomplets avant submission.
 *  - ON DELETE CASCADE pour conserver la cohérence si le document
 *    parent est supprimé (rare, BROUILLON seulement — cf.
 *    DocumentWorkflowService).
 *  - Extension `uuid-ossp` requise → déjà activée par migration
 *    `1779200000245-ActiverExtensionUuidOssp.ts`.
 */
export class CreerTableLettreCadrageDetail1779200000320 implements MigrationInterface {
  name = 'CreerTableLettreCadrageDetail1779200000320';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE lettre_cadrage_detail (
        id                                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        fk_document                       UUID NOT NULL UNIQUE REFERENCES document_officiel(id) ON DELETE CASCADE,
        reference_holding                 VARCHAR(100),
        date_emission_holding             DATE,
        signataire_holding                VARCHAR(255),
        pnb_cible_mfcfa                   NUMERIC(15,2),
        rn_cible_mfcfa                    NUMERIC(15,2),
        croissance_credits_pct            NUMERIC(5,2),
        croissance_depots_pct             NUMERIC(5,2),
        coefficient_exploitation_pct      NUMERIC(5,2),
        roe_cible_pct                     NUMERIC(5,2),
        ratio_solvabilite_min_pct         NUMERIC(5,2),
        ratio_liquidite_min_pct           NUMERIC(5,2),
        ratio_division_risques_pct        NUMERIC(5,2),
        date_debut_saisie                 DATE,
        date_limite_saisie_cr             DATE,
        date_validation_dga               DATE,
        date_validation_dg                DATE,
        date_publication_bceao            DATE,
        orientations_strategiques         TEXT,
        date_creation                     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        date_modification                 TIMESTAMP,
        utilisateur_creation              VARCHAR(255) NOT NULL,
        utilisateur_modification          VARCHAR(255),
        CONSTRAINT ck_pnb_positif CHECK (pnb_cible_mfcfa IS NULL OR pnb_cible_mfcfa >= 0),
        CONSTRAINT ck_rn_positif CHECK (rn_cible_mfcfa IS NULL OR rn_cible_mfcfa >= 0),
        CONSTRAINT ck_ratios_dans_plage CHECK (
          (croissance_credits_pct IS NULL OR croissance_credits_pct BETWEEN -100 AND 200)
          AND (croissance_depots_pct IS NULL OR croissance_depots_pct BETWEEN -100 AND 200)
          AND (coefficient_exploitation_pct IS NULL OR coefficient_exploitation_pct BETWEEN 0 AND 200)
          AND (roe_cible_pct IS NULL OR roe_cible_pct BETWEEN -100 AND 100)
          AND (ratio_solvabilite_min_pct IS NULL OR ratio_solvabilite_min_pct BETWEEN 0 AND 100)
          AND (ratio_liquidite_min_pct IS NULL OR ratio_liquidite_min_pct BETWEEN 0 AND 200)
          AND (ratio_division_risques_pct IS NULL OR ratio_division_risques_pct BETWEEN 0 AND 100)
        )
      );
    `);
    await queryRunner.query(
      `CREATE INDEX idx_lcd_fk_document ON lettre_cadrage_detail(fk_document);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_lcd_pnb ON lettre_cadrage_detail(pnb_cible_mfcfa);`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS lettre_cadrage_detail CASCADE;`,
    );
  }
}
