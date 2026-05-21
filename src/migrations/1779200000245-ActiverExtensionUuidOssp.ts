import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lot 8.1.A — Active l'extension Postgres `uuid-ossp` pour permettre
 * l'utilisation de `uuid_generate_v4()` comme valeur par défaut des PK
 * des 5 nouvelles tables workflow signature (campagne_budgetaire,
 * campagne_comite_membre, document_officiel, document_visa,
 * document_signature).
 *
 * **Découverte au cadrage** : la spec affirmait que `uuid-ossp` était
 * "déjà activé" — vérification du code (grep migrations) : faux. Aucune
 * migration n'active l'extension, aucune table existante n'utilise UUID
 * comme PK. Cette migration ajoute donc la fondation.
 *
 * Migration idempotente via `IF NOT EXISTS`.
 */
export class ActiverExtensionUuidOssp1779200000245 implements MigrationInterface {
  name = 'ActiverExtensionUuidOssp1779200000245';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`);
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // On NE supprime PAS l'extension au rollback : d'autres tables
    // pourraient l'utiliser entre-temps. DROP EXTENSION nécessiterait
    // CASCADE et casserait tout ce qui en dépend. Décision conservatrice.
  }
}
