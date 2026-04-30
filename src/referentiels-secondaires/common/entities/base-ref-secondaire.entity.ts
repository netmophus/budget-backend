import { Column } from 'typeorm';

/**
 * Classe abstraite — colonnes communes des 13 référentiels secondaires
 * (énumérations métier centralisées).
 *
 * Pas une `@Entity` — chaque référentiel concret pose sa propre PK via
 * `@PrimaryGeneratedColumn` + son propre `@Entity({ name: 'ref_xxx' })`
 * pour pointer vers la bonne table.
 *
 * Cf. `docs/conventions.md` §8 : varchar + table ref_* > CHECK contrainte.
 */
export abstract class BaseRefSecondaire {
  @Column({ type: 'varchar', length: 50 })
  code!: string;

  @Column({ type: 'varchar', length: 200 })
  libelle!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'int', default: 0 })
  ordre!: number;

  @Column({ name: 'est_actif', type: 'boolean', default: true })
  estActif!: boolean;

  /**
   * Vrai si la valeur est nécessaire au fonctionnement applicatif et
   * ne peut pas être supprimée par un admin (ex. statut 'ouvert' d'une
   * version, type d'action 'CREATE'). La modification du `code` est
   * également interdite sur ces lignes.
   */
  @Column({ name: 'est_systeme', type: 'boolean', default: false })
  estSysteme!: boolean;

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

/**
 * Type utilitaire pour les concrétisations qui ajoutent leur propre
 * surrogate key (`id`).
 */
export type RefSecondaireWithId = BaseRefSecondaire & { id: string };
