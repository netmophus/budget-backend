import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Chantier A — seed du contexte IA de BSIC NIGER dans configuration_banque.
 *
 * Renseigne positionnement / contexte_marche / concurrents (créés vides en
 * B1) afin que le prompt IA enrichi dispose de matière. Idempotent :
 * `COALESCE` ne remplit QUE si la valeur est encore NULL — ne jamais
 * écraser une saisie faite via l'UI Configuration banque (Lot B4).
 */
export class SeedContexteIaBsic1779200000600 implements MigrationInterface {
  name = 'SeedContexteIaBsic1779200000600';

  private static readonly POSITIONNEMENT =
    'Retail (Particuliers + PME) et Corporate (Grandes Entreprises + Etat + ' +
    "ONG). Reseau d'agences a Niamey, Zinder, Maradi, Tahoua.";

  private static readonly CONTEXTE_MARCHE =
    'Marche nigerien en transformation : essor du mobile money (Airtel Money, ' +
    'Orange Money, Moov Money), pression reglementaire croissante sur la ' +
    'conformite LCB-FT, digitalisation des services bancaires.';

  private static readonly CONCURRENTS =
    'Ecobank Niger, BOA Niger, Sonibank, SGB Niger, Bank of Africa';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `UPDATE "configuration_banque"
         SET "positionnement"  = COALESCE("positionnement", $1),
             "contexte_marche" = COALESCE("contexte_marche", $2),
             "concurrents"     = COALESCE("concurrents", $3)
       WHERE "id" = 1`,
      [
        SeedContexteIaBsic1779200000600.POSITIONNEMENT,
        SeedContexteIaBsic1779200000600.CONTEXTE_MARCHE,
        SeedContexteIaBsic1779200000600.CONCURRENTS,
      ],
    );
  }

  public async down(): Promise<void> {
    // No-op volontaire : ces champs sont éditables via l'UI (B4). Les
    // remettre à NULL au rollback risquerait de détruire une saisie
    // utilisateur. Le seed initial (si NULL) n'est pas réversible sans risque.
  }
}
