import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lot 3.6 — Vue matérialisée `mv_indicateurs_budget`.
 *
 * Pré-agrège par (version × scénario × CR × exercice) les sommes
 * utiles au calcul des 3 indicateurs métier UEMOA :
 *
 *  - **PNB** (Produit Net Bancaire) = total classe 7 − total 67xxx
 *  - **MNI** (Marge Nette d'Intérêt) = total 76xxx − total 67xxx
 *  - **Coefficient d'exploitation** = charges_hors_interets / PNB × 100
 *    (charges_hors_interets = classe 6 − 67xxx)
 *
 * Décisions Q15 / Q16 / Q17 (cf. mandat 3.6) :
 *  - Q15 — vue matérialisée rafraîchie à la demande (REFRESH
 *    MATERIALIZED VIEW CONCURRENTLY) ; index UNIQUE obligatoire pour
 *    éviter le verrou exclusif sur les SELECT pendant le refresh.
 *  - Q16 — drill-down par CR (clé d'agrégation = CR), pas par classe
 *    ni par mois au MVP.
 *  - Q17 — comparaison scénarios côte à côte → la vue garde
 *    `fk_scenario` dans la clé pour permettre le pivot côté service.
 *
 * Notes d'implémentation :
 *  - On utilise `dim_temps.exercice_fiscal` (int déjà calculé,
 *    indexable) plutôt que `EXTRACT(YEAR FROM t.date)` — équivalent
 *    fonctionnel, perf nettement meilleure.
 *  - `dim_compte.classe` est `varchar(50)` qui contient '6', '7', etc.
 *    — comparaisons en littéraux string.
 *  - Jointures sur les dimensions SCD2 (`dim_compte`,
 *    `dim_centre_responsabilite`) restreintes à `version_courante=true`
 *    (libellé du CR cohérent avec celui affiché en grille).
 *
 * Cf. `docs/modele-donnees.md` §4.7.
 */
export class CreateMvIndicateursBudget1779200000050
  implements MigrationInterface
{
  name = 'CreateMvIndicateursBudget1779200000050';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE MATERIALIZED VIEW "mv_indicateurs_budget" AS
      SELECT
        f.fk_version,
        f.fk_scenario,
        f.fk_centre,
        cr.code_cr,
        cr.libelle AS libelle_cr,
        t.exercice_fiscal AS exercice,

        -- Totaux par classe
        SUM(CASE
          WHEN c.classe = '6' THEN f.montant_devise
          ELSE 0 END) AS total_classe_6,
        SUM(CASE
          WHEN c.classe = '7' THEN f.montant_devise
          ELSE 0 END) AS total_classe_7,

        -- Totaux sous-classes utiles
        SUM(CASE
          WHEN c.code_compte LIKE '67%'
          THEN f.montant_devise ELSE 0 END)
          AS total_67_charges_interets,
        SUM(CASE
          WHEN c.code_compte LIKE '76%'
          THEN f.montant_devise ELSE 0 END)
          AS total_76_produits_interets,

        -- Indicateurs dérivés
        (SUM(CASE WHEN c.classe = '7' THEN f.montant_devise ELSE 0 END)
         - SUM(CASE WHEN c.code_compte LIKE '67%' THEN f.montant_devise ELSE 0 END)
        ) AS pnb,

        (SUM(CASE WHEN c.code_compte LIKE '76%' THEN f.montant_devise ELSE 0 END)
         - SUM(CASE WHEN c.code_compte LIKE '67%' THEN f.montant_devise ELSE 0 END)
        ) AS mni,

        -- Charges hors intérêts (numérateur du coef d'exploitation)
        SUM(CASE
          WHEN c.classe = '6' AND c.code_compte NOT LIKE '67%'
          THEN f.montant_devise ELSE 0 END)
          AS charges_hors_interets,

        COUNT(*) AS nb_lignes,
        MAX(f.date_modification) AS derniere_modif

      FROM fait_budget f
      JOIN dim_compte c ON c.id = f.fk_compte
        AND c.version_courante = true
      JOIN dim_centre_responsabilite cr ON cr.id = f.fk_centre
        AND cr.version_courante = true
      JOIN dim_temps t ON t.id = f.fk_temps
      GROUP BY
        f.fk_version, f.fk_scenario, f.fk_centre,
        cr.code_cr, cr.libelle, t.exercice_fiscal
    `);

    // Index UNIQUE — prérequis de REFRESH MATERIALIZED VIEW CONCURRENTLY.
    await q.query(`
      CREATE UNIQUE INDEX "idx_mv_indicateurs_unique"
        ON "mv_indicateurs_budget"
        (fk_version, fk_scenario, fk_centre, exercice)
    `);

    // Index secondaire pour les filtres par version (cas le plus
    // fréquent : tableau de bord d'une version donnée).
    await q.query(`
      CREATE INDEX "idx_mv_indicateurs_version"
        ON "mv_indicateurs_budget" (fk_version)
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    // DROP MATERIALIZED VIEW supprime aussi les index attachés.
    await q.query(
      `DROP MATERIALIZED VIEW IF EXISTS "mv_indicateurs_budget"`,
    );
  }
}
