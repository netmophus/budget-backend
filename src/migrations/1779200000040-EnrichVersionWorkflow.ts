import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lot 3.5 — Enrichissement `dim_version` pour le workflow de
 * validation budgétaire (Q4 — 4 statuts).
 *
 * Cycle :
 *   ouvert (Brouillon) → soumis → valide → gele (Publié, immuable)
 *                            ↓
 *                        [rejet]
 *                            ↓
 *                         ouvert (avec commentaire de rejet)
 *
 * Colonnes ajoutées (10) :
 *  - 4 commentaires (un par transition) : soumission / validation /
 *    rejet / publication.
 *  - 6 traçabilité (date + user pour soumission / validation / rejet).
 *
 * Note : `date_gel` et `utilisateur_gel` existent déjà depuis le Lot
 * 2.4B (commentaire entité : « gel = publication ») — on ne les
 * touche pas. Ils servent d'équivalents de `date_publication` /
 * `utilisateur_publication` (cf. mapping vocabulaire docs/modele-
 * donnees.md §4.1.2).
 *
 * Backfill : aucun (toutes les colonnes sont NULL pour les versions
 * existantes — chemin nominal pour les versions Brouillon créées
 * avant 3.5).
 *
 * Cf. `docs/modele-donnees.md` §4.6.
 */
export class EnrichVersionWorkflow1779200000040
  implements MigrationInterface
{
  name = 'EnrichVersionWorkflow1779200000040';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE "dim_version"
        ADD COLUMN "commentaire_soumission" text,
        ADD COLUMN "commentaire_validation" text,
        ADD COLUMN "commentaire_rejet" text,
        ADD COLUMN "commentaire_publication" text,
        ADD COLUMN "date_soumission" timestamp,
        ADD COLUMN "utilisateur_soumission" varchar(255),
        ADD COLUMN "date_validation" timestamp,
        ADD COLUMN "utilisateur_validation" varchar(255),
        ADD COLUMN "date_rejet" timestamp,
        ADD COLUMN "utilisateur_rejet" varchar(255)
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE "dim_version"
        DROP COLUMN IF EXISTS "utilisateur_rejet",
        DROP COLUMN IF EXISTS "date_rejet",
        DROP COLUMN IF EXISTS "utilisateur_validation",
        DROP COLUMN IF EXISTS "date_validation",
        DROP COLUMN IF EXISTS "utilisateur_soumission",
        DROP COLUMN IF EXISTS "date_soumission",
        DROP COLUMN IF EXISTS "commentaire_publication",
        DROP COLUMN IF EXISTS "commentaire_rejet",
        DROP COLUMN IF EXISTS "commentaire_validation",
        DROP COLUMN IF EXISTS "commentaire_soumission"
    `);
  }
}
