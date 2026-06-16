import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lot 8.8 — elargit la profondeur du plan comptable dim_compte de 4 a 6
 * niveaux, pour s'aligner sur le PCB UMOA Revise officiel de la BCEAO
 * (Annexe 6 a la Decision n357-11-2016) qui descend jusqu'a 6 niveaux
 * (classe 1 chiffre -> compte detaille 5-6 chiffres).
 *
 * Strictement declaratif : seule la contrainte CHECK est elargie. La
 * validation hierarchique applicative (enfant = parent + 1, racine = 1)
 * est deja generique. Perimetre dim_compte SEUL : dim_produit et
 * dim_ligne_metier conservent leur limite a 4 niveaux (non-PCB).
 *
 * Contrainte existante (cf. 1777900000000-CreateDimCompte) :
 *   ck_dim_compte_niveau CHECK (niveau BETWEEN 1 AND 4)
 */
export class ElargirProfondeurDimCompte1779200000460 implements MigrationInterface {
  name = 'ElargirProfondeurDimCompte1779200000460';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE "dim_compte" DROP CONSTRAINT IF EXISTS "ck_dim_compte_niveau"`,
    );
    await q.query(
      `ALTER TABLE "dim_compte" ADD CONSTRAINT "ck_dim_compte_niveau" CHECK ("niveau" BETWEEN 1 AND 6)`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE "dim_compte" DROP CONSTRAINT IF EXISTS "ck_dim_compte_niveau"`,
    );
    await q.query(
      `ALTER TABLE "dim_compte" ADD CONSTRAINT "ck_dim_compte_niveau" CHECK ("niveau" BETWEEN 1 AND 4)`,
    );
  }
}
