import { Column } from 'typeorm';

/**
 * Classe abstraite SCD2 — factorise les colonnes communes d'historisation
 * type 2 et d'audit applicatif pour toutes les dimensions structurantes.
 *
 * **Invariants** (cf. docs/modele-donnees.md §6.2) :
 *  - pour un même `code_<entité>`, les intervalles
 *    `[date_debut_validite, date_fin_validite)` sont **disjoints** et
 *    **contigus** (pas de trou, pas de chevauchement).
 *  - au plus une seule ligne avec `version_courante = true` par
 *    business key ; cette ligne a `date_fin_validite IS NULL`.
 *  - modifier un attribut SCD2-tracé crée une nouvelle ligne ;
 *    modifier un attribut purement opérationnel met à jour en place.
 *
 * **Note** : cette classe ne porte PAS la PK `id` ni la business key
 * (`code_<entité>`) — chaque entité concrète les définit avec son
 * propre nom de colonne. C'est une classe de **mixin**, pas une
 * `@Entity` à part entière.
 *
 * Usage type :
 * ```typescript
 * @Entity({ name: 'dim_structure' })
 * export class DimStructure extends Scd2Entity {
 *   @PrimaryGeneratedColumn('identity', { type: 'bigint' })
 *   id!: string;
 *
 *   @Column({ name: 'code_structure', type: 'varchar', length: 50 })
 *   codeStructure!: string;
 *
 *   @Column({ name: 'libelle', type: 'varchar', length: 150 })
 *   libelle!: string;
 * }
 * ```
 */
export abstract class Scd2Entity {
  @Column({ name: 'date_debut_validite', type: 'date' })
  dateDebutValidite!: string;

  @Column({ name: 'date_fin_validite', type: 'date', nullable: true })
  dateFinValidite!: string | null;

  @Column({ name: 'version_courante', type: 'boolean', default: true })
  versionCourante!: boolean;

  @Column({ name: 'est_actif', type: 'boolean', default: true })
  estActif!: boolean;

  @Column({
    name: 'date_creation',
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
  })
  dateCreation!: Date;

  @Column({
    name: 'utilisateur_creation',
    type: 'varchar',
    length: 255,
    default: 'system',
  })
  utilisateurCreation!: string;

  @Column({
    name: 'date_modification',
    type: 'timestamp',
    nullable: true,
  })
  dateModification!: Date | null;

  @Column({
    name: 'utilisateur_modification',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  utilisateurModification!: string | null;
}
