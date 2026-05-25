import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration Lot 8.3.E — table `lettre_officialisation_detail` (1-1 avec
 * `document_officiel` pour les documents de type D12_LETTRE_OFFICIALISATION).
 *
 * 6e et dernier type métier riche de la phase 8.3 après D2 (Lot 8.2.C
 * migration 320), D3 (Lot 8.3.A migration 330), D5 (Lot 8.3.B migration
 * 340), D1 (Lot 8.3.C migration 350) et D11 (Lot 8.3.D migration 360).
 * Numérotation 370 en séquence stricte.
 *
 * **Position dans le cycle BSIC** : la Lettre d'officialisation est
 * émise APRÈS la signature du PV CA (D11). Elle notifie l'approbation
 * du budget aux parties prenantes (équipe direction, filiales, BCEAO,
 * CREPMF, holding, etc.) et marque l'entrée en vigueur officielle du
 * budget approuvé.
 *
 * Cycle complet : **D1 (Note préparatoire DG) → D3 (Orientation Comité)
 * → D2 (Cadrage Directeurs CR) → D5 (Mobilisation tous Directeurs) →
 * D11 (PV d'approbation CA) → D12 (Lettre d'officialisation)**.
 *
 * Champs métier (11 + 6 techniques = 17 colonnes) :
 *  - Identification (n° lettre + date émission + objet)
 *  - Référence PV CA (texte libre — Option A actée, pas de FK forte)
 *  - Destinataires (principaux + copies + pièces jointes)
 *  - Corps de la lettre (TipTap riche, 1 colonne)
 *  - Signature & officialisation (signataire + date entrée vigueur +
 *    drapeau cachet apposé)
 *
 * Choix techniques (cohérents Lots 8.2.C / 8.3.A / 8.3.B / 8.3.C / 8.3.D) :
 *  - UUID PK + UUID FK document_officiel + VARCHAR(255) email audit +
 *    TIMESTAMP plain (aligné D1/D11)
 *  - Tous les champs métier nullable (draft incomplet autorisé en BROUILLON)
 *  - 3 CHECK SQL conditionnels avec suffixe `_lo` (anti-collision)
 *  - **3e CHECK relationnel cross-fields du projet** :
 *    `ck_dates_lo_coherentes` garantit `date_entree_vigueur >=
 *    date_emission` (NULL-friendly). Après `ck_dates_preparation_coherentes`
 *    (D1) et `ck_quorum_coherent_pv` (D11).
 *  - 4 index : `fk_document` (jointure 1-1), `date_emission` (requêtes
 *    historiques), `numero_lettre` (recherche par n°), `reference_pv_ca`
 *    (lookup "quelles lettres référencent ce PV ?")
 *  - Préfixe index `idx_lod_*` (LettreOfficialisationDetail)
 *  - **Option A actée** : `reference_pv_ca` est VARCHAR(100) libre, AUCUN
 *    CHECK ni FK vers `pv_approbation_detail` — une lettre peut référencer
 *    un PV externe (filiale, holding), un PV non encore créé en base, ou
 *    plusieurs PV via texte libre.
 *  - Extension `uuid-ossp` déjà activée (migration 1779200000245)
 */
export class CreerTableLettreOfficialisationDetail1779200000370 implements MigrationInterface {
  name = 'CreerTableLettreOfficialisationDetail1779200000370';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE lettre_officialisation_detail (
        id                              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        fk_document                     UUID NOT NULL UNIQUE REFERENCES document_officiel(id) ON DELETE CASCADE,
        numero_lettre                   VARCHAR(50),
        date_emission                   DATE,
        destinataires_principaux        VARCHAR(2000),
        destinataires_copies            VARCHAR(2000),
        objet                           VARCHAR(500),
        reference_pv_ca                 VARCHAR(100),
        corps_html                      TEXT,
        pieces_jointes                  VARCHAR(2000),
        signataire                      VARCHAR(255),
        date_entree_vigueur             DATE,
        cachet_appose                   BOOLEAN,
        date_creation                   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        date_modification               TIMESTAMP,
        utilisateur_creation            VARCHAR(255) NOT NULL,
        utilisateur_modification        VARCHAR(255),
        CONSTRAINT ck_date_emission_plausible_lo CHECK (
          date_emission IS NULL OR date_emission BETWEEN DATE '2020-01-01' AND DATE '2050-12-31'
        ),
        CONSTRAINT ck_date_entree_vigueur_plausible_lo CHECK (
          date_entree_vigueur IS NULL OR date_entree_vigueur BETWEEN DATE '2020-01-01' AND DATE '2050-12-31'
        ),
        CONSTRAINT ck_dates_lo_coherentes CHECK (
          date_emission IS NULL
          OR date_entree_vigueur IS NULL
          OR date_entree_vigueur >= date_emission
        )
      );
    `);
    await queryRunner.query(
      `CREATE INDEX idx_lod_fk_document ON lettre_officialisation_detail(fk_document);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_lod_date_emission ON lettre_officialisation_detail(date_emission);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_lod_numero_lettre ON lettre_officialisation_detail(numero_lettre);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_lod_reference_pv_ca ON lettre_officialisation_detail(reference_pv_ca);`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS lettre_officialisation_detail CASCADE;`,
    );
  }
}
