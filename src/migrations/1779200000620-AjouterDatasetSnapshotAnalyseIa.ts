import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Chantier C-fix — fige le dataset complet d'une analyse IA.
 *
 * Ajoute `dataset_snapshot` (jsonb) à `analyse_ia` : l'EcartsResponseDto
 * entier (filtres + kpi + totaux + lignes) + codeVersion/codeScenario figés
 * au moment de la génération. Rend le PDF historisé fidèle (document
 * d'archive) au lieu de recalculer les écarts.
 *
 * Pas de backfill : les analyses déjà historisées (C1) restent NULL et
 * retombent sur le recalcul à l'export (rétrocompatibilité).
 */
export class AjouterDatasetSnapshotAnalyseIa1779200000620 implements MigrationInterface {
  name = 'AjouterDatasetSnapshotAnalyseIa1779200000620';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE "analyse_ia" ADD COLUMN IF NOT EXISTS "dataset_snapshot" jsonb`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE "analyse_ia" DROP COLUMN IF EXISTS "dataset_snapshot"`,
    );
  }
}
