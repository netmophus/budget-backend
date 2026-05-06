import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lot 3 UX C.2 + C.3 — Nettoyage des libellés résidus de tests :
 *
 *  - Compte 611100 : « Salaires bruts (test upsert manuel) »
 *                  → « Salaires bruts »
 *  - Compte 611400 : « Indemnites de transport (test) »
 *                  → « Indemnités de transport » (avec accent)
 *
 * Ces libellés étaient des résidus de tests manuels Lot 2/3 qui se
 * sont retrouvés en base (probablement via test-upsert.csv ou
 * équivalent). Pas adapté pour la démo client.
 *
 * **Idempotent** : la clause WHERE filtre sur le libellé exact
 * d'origine. Si la migration a déjà tourné (ou si les libellés sont
 * différents — environnement vierge, prod), l'UPDATE ne touche rien.
 *
 * **Pas de SCD2 reset** : on ne crée PAS de nouvelle version SCD2
 * (date_fin_validite, version_courante=false sur l'ancienne, ré-INSERT
 * d'une nouvelle ligne) car c'est un correctif de typo, pas un
 * changement métier ayant valeur historique. Le diff est invisible
 * pour les rapports historiques.
 *
 * `down()` ne ré-injecte volontairement pas les libellés "(test)"
 * — c'était des artefacts à corriger, pas un état désiré.
 */
export class RenommerComptesTest1779200000070 implements MigrationInterface {
  name = 'RenommerComptesTest1779200000070';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      UPDATE "dim_compte"
         SET "libelle" = 'Salaires bruts'
       WHERE "code_compte" = '611100'
         AND "libelle" = 'Salaires bruts (test upsert manuel)'
    `);
    await q.query(`
      UPDATE "dim_compte"
         SET "libelle" = 'Indemnités de transport'
       WHERE "code_compte" = '611400'
         AND "libelle" = 'Indemnites de transport (test)'
    `);
  }

  public async down(_q: QueryRunner): Promise<void> {
    // Volontairement vide : on ne ré-injecte pas les "(test)" qui
    // étaient un défaut à corriger. La migration est conceptuellement
    // un fix de données, pas un changement de schéma réversible.
  }
}
