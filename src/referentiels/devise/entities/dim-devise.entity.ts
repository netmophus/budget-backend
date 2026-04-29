import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Dimension `dim_devise` — référentiel BCEAO des devises (cf.
 * `docs/modele-donnees.md` §3.8). Pas de SCD2 : les **taux de change**
 * sont historisés à part dans `ref_taux_change` (hors périmètre 2.2B).
 *
 * Invariant : exactement une ligne avec `est_devise_pivot = true`,
 * garanti par l'index unique partiel `uq_dim_devise_pivot` (cf.
 * migration `CreateDimDevise1777740000000`) ET par le service
 * (`DeviseService.create` / `update`) en première ligne de défense.
 */
@Entity({ name: 'dim_devise' })
@Index('ix_dim_devise_est_active', ['estActive'])
export class DimDevise {
  @PrimaryGeneratedColumn('identity', { type: 'bigint' })
  id!: string;

  @Index('uq_dim_devise_code_iso', { unique: true })
  @Column({ name: 'code_iso', type: 'char', length: 3 })
  codeIso!: string;

  @Column({ name: 'libelle', type: 'varchar', length: 100 })
  libelle!: string;

  @Column({ name: 'symbole', type: 'varchar', length: 10, nullable: true })
  symbole!: string | null;

  @Column({ name: 'nb_decimales', type: 'int', default: 2 })
  nbDecimales!: number;

  @Column({ name: 'est_devise_pivot', type: 'boolean', default: false })
  estDevisePivot!: boolean;

  @Column({ name: 'est_active', type: 'boolean', default: true })
  estActive!: boolean;

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

  @Column({ name: 'date_modification', type: 'timestamp', nullable: true })
  dateModification!: Date | null;

  @Column({
    name: 'utilisateur_modification',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  utilisateurModification!: string | null;
}
