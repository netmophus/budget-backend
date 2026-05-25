import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration Lot 8.3.F — cleanup cosmétique des 13 CHECK constraints
 * legacy sans suffixe sur les 3 premières tables détail métier
 * (D2/D3/D5).
 *
 * **Contexte** : la convention "suffixe par table" pour les CHECK
 * (`_lc` / `_no` / `_lm` / `_np` / `_pv` / `_lo`) a été introduite
 * progressivement à partir du Lot 8.3.B (D5). Les migrations
 * antérieures (320 D2, 330 D3) et certaines contraintes de la 340
 * D5 utilisent des noms génériques (`ck_pnb_positif`,
 * `ck_ratios_dans_plage`, etc.) qui présentent un risque de
 * collision future et brouillent la traçabilité table-CHECK.
 *
 * **Action** : ALTER TABLE ... RENAME CONSTRAINT pour 13 contraintes :
 *  - 3 sur `lettre_cadrage_detail` (D2) → suffixe `_lc`
 *  - 7 sur `note_orientation_detail` (D3) → suffixe `_no`
 *  - 3 sur `lettre_mobilisation_detail` (D5) → suffixe `_lm`
 *    (4e CHECK D5 `ck_exercice_plausible_lm` déjà bien nommé,
 *    pas touché ici)
 *
 * **Gravité = cosmétique** : aucun changement de logique, juste
 * uniformisation des noms. Les contraintes restent fonctionnelles.
 * Aucune modification côté entités TypeScript (les noms de CHECK
 * ne sont jamais référencés en code TS, seulement par Postgres).
 *
 * **Réversibilité** : `down()` renomme dans l'autre sens. Migration
 * 100% safe à rollback.
 *
 * **Post-merge** : smoke test en SQL direct conseillé — essayer
 * d'insérer une valeur violant un CHECK renommé pour confirmer que
 * l'erreur Postgres mentionne bien le nouveau nom suffixé.
 *
 * Cohérence avec la convention installée à partir du Lot 8.3.B :
 *  - `_lc` = LettreCadrageDetail (D2)
 *  - `_no` = NoteOrientationDetail (D3)
 *  - `_lm` = LettreMobilisationDetail (D5)
 *  - `_np` = NotePreparatoireDetail (D1)
 *  - `_pv` = PvApprobationDetail (D11)
 *  - `_lo` = LettreOfficialisationDetail (D12)
 */
export class RenommerCheckLegacyTablesDetailMetier1779200000380 implements MigrationInterface {
  name = 'RenommerCheckLegacyTablesDetailMetier1779200000380';

  // Liste des renommages (ancien → nouveau), groupée par table pour clarté.
  private readonly RENAMES: Array<{
    table: string;
    oldName: string;
    newName: string;
  }> = [
    // ─── D2 lettre_cadrage_detail (3 CHECK) ──────────────────────
    {
      table: 'lettre_cadrage_detail',
      oldName: 'ck_pnb_positif',
      newName: 'ck_pnb_positif_lc',
    },
    {
      table: 'lettre_cadrage_detail',
      oldName: 'ck_rn_positif',
      newName: 'ck_rn_positif_lc',
    },
    {
      table: 'lettre_cadrage_detail',
      oldName: 'ck_ratios_dans_plage',
      newName: 'ck_ratios_dans_plage_lc',
    },
    // ─── D3 note_orientation_detail (7 CHECK) ────────────────────
    {
      table: 'note_orientation_detail',
      oldName: 'ck_cours_petrole_positif',
      newName: 'ck_cours_petrole_positif_no',
    },
    {
      table: 'note_orientation_detail',
      oldName: 'ck_croissance_plausible',
      newName: 'ck_croissance_plausible_no',
    },
    {
      table: 'note_orientation_detail',
      oldName: 'ck_exercice_plausible',
      newName: 'ck_exercice_plausible_no',
    },
    {
      table: 'note_orientation_detail',
      oldName: 'ck_inflation_plausible',
      newName: 'ck_inflation_plausible_no',
    },
    {
      table: 'note_orientation_detail',
      oldName: 'ck_parts_marche_plausibles',
      newName: 'ck_parts_marche_plausibles_no',
    },
    {
      table: 'note_orientation_detail',
      oldName: 'ck_taux_change_positif',
      newName: 'ck_taux_change_positif_no',
    },
    {
      table: 'note_orientation_detail',
      oldName: 'ck_taux_directeur_plausible',
      newName: 'ck_taux_directeur_plausible_no',
    },
    // ─── D5 lettre_mobilisation_detail (3 CHECK sans suffixe ─────
    // ─── + 1 deja suffixe `ck_exercice_plausible_lm` non touche) ─
    {
      table: 'lettre_mobilisation_detail',
      oldName: 'ck_nb_objectifs_positif',
      newName: 'ck_nb_objectifs_positif_lm',
    },
    {
      table: 'lettre_mobilisation_detail',
      oldName: 'ck_pnb_consolide_positif',
      newName: 'ck_pnb_consolide_positif_lm',
    },
    {
      table: 'lettre_mobilisation_detail',
      oldName: 'ck_rn_consolide_positif',
      newName: 'ck_rn_consolide_positif_lm',
    },
    {
      table: 'lettre_mobilisation_detail',
      oldName: 'ck_taux_mobilisation_plausibles',
      newName: 'ck_taux_mobilisation_plausibles_lm',
    },
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const r of this.RENAMES) {
      await queryRunner.query(
        `ALTER TABLE ${r.table} RENAME CONSTRAINT ${r.oldName} TO ${r.newName};`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Rename inverse — itération dans l'ordre inverse pour la propreté
    // (peu importe en pratique car les renommages sont indépendants).
    for (const r of [...this.RENAMES].reverse()) {
      await queryRunner.query(
        `ALTER TABLE ${r.table} RENAME CONSTRAINT ${r.newName} TO ${r.oldName};`,
      );
    }
  }
}
