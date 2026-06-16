import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lot 8.7.A — colonne libelle_jour sur dim_temps.
 *
 * Permet à l'ADMIN de nommer un jour férié (Aïd el-Fitr, Tabaski, Mawlid,
 * décret présidentiel) lorsqu'il bascule jour_ouvre a false via PATCH.
 * Nullable, sans valeur par défaut : aucun impact sur les lignes existantes
 * ni sur les services consommateurs (aucun n'agrege sur cette colonne).
 */
export class AjouterLibelleJourDimTemps1779200000440 implements MigrationInterface {
  name = 'AjouterLibelleJourDimTemps1779200000440';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE "dim_temps" ADD COLUMN IF NOT EXISTS "libelle_jour" varchar(255) NULL`,
    );
    await q.query(
      `COMMENT ON COLUMN "dim_temps"."libelle_jour" IS 'Libelle du jour ferie (ex: Aid el-Fitr 2027, Tabaski, Decret presidentiel). Saisi par ADMIN. Lot 8.7.A.'`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE "dim_temps" DROP COLUMN IF EXISTS "libelle_jour"`,
    );
  }
}
