import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lot 6.6.bis — Fix inversion libellés classes PCB 8/9.
 *
 * La migration originelle `1779000000050-CreateRefClasseCompte` créait
 * `code='8' → 'Hors bilan'` et `code='9' → 'Comptabilité analytique'`.
 * C'est l'inverse selon le Plan Comptable Bancaire UMOA Révisé
 * (Décision BCEAO N°357-11-2016) tel qu'appliqué dans les Grand-Livres
 * réels des banques UEMOA (vérifié sur le GL BSIC NIGER au 31/12/2025
 * où la classe 9 contient les comptes d'engagements hors bilan).
 *
 * Cette migration corrective applique l'UPDATE sur les bases existantes.
 * Les déploiements neufs auront directement les bons libellés via la
 * migration originelle (corrigée dans le même commit Lot 6.6.bis).
 *
 * Idempotente : l'UPDATE WHERE code=... ne pose pas de problème en cas
 * de réexécution (rollback puis re-up).
 */
export class FixClassePCB8et91779200000230 implements MigrationInterface {
  name = 'FixClassePCB8et91779200000230';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `UPDATE ref_classe_compte SET libelle = 'Comptabilité analytique' WHERE code = '8'`,
    );
    await q.query(
      `UPDATE ref_classe_compte SET libelle = 'Hors bilan' WHERE code = '9'`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      `UPDATE ref_classe_compte SET libelle = 'Hors bilan' WHERE code = '8'`,
    );
    await q.query(
      `UPDATE ref_classe_compte SET libelle = 'Comptabilité analytique' WHERE code = '9'`,
    );
  }
}
