import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { Scd2Entity } from '../../../common/entities/scd2.entity';

export type TypeProduit = 'credit' | 'depot' | 'service' | 'marche' | 'autre';

/**
 * `dim_produit` — Produits bancaires : crédits / dépôts / services /
 * opérations de marché. Cf. `docs/modele-donnees.md` §3.6.
 *
 * Stratégie A en auto-référence (`scd2-pattern.md` §8) — pattern
 * jumeau de `dim_compte` et `dim_ligne_metier`. Le service expose
 * `relinkAfterProduitRevision` pour repointer les enfants après
 * création d'une nouvelle version SCD2 du parent.
 */
@Entity({ name: 'dim_produit' })
@Index('ix_dim_produit_parent', ['fkProduitParent'])
@Index('ix_dim_produit_type', ['typeProduit'])
@Index('ix_dim_produit_porteur_interets', ['estPorteurInterets'])
@Index('uq_dim_produit_business_date', ['codeProduit', 'dateDebutValidite'], {
  unique: true,
})
export class DimProduit extends Scd2Entity {
  @PrimaryGeneratedColumn('identity', { type: 'bigint' })
  id!: string;

  @Column({ name: 'code_produit', type: 'varchar', length: 50 })
  codeProduit!: string;

  @Column({ name: 'libelle', type: 'varchar', length: 200 })
  libelle!: string;

  @Column({ name: 'type_produit', type: 'varchar', length: 20 })
  typeProduit!: TypeProduit;

  @Column({ name: 'fk_produit_parent', type: 'bigint', nullable: true })
  fkProduitParent!: string | null;

  @Column({ name: 'niveau', type: 'int' })
  niveau!: number;

  @Column({ name: 'est_porteur_interets', type: 'boolean', default: false })
  estPorteurInterets!: boolean;

  @ManyToOne(() => DimProduit, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'fk_produit_parent' })
  parent?: DimProduit | null;
}
