import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { Scd2Entity } from '../../../common/entities/scd2.entity';

/**
 * `dim_ligne_metier` — Ligne d'activité bancaire (retail, corporate,
 * trésorerie, support…). Cf. `docs/modele-donnees.md` §3.5.
 *
 * Stratégie A (lien vivant) sur la FK auto-référente
 * `fk_ligne_metier_parent` (cf. `scd2-pattern.md` §8). Pattern jumeau
 * de `dim_compte` — voir `LigneMetierService.relinkAfterLigneMetierRevision`.
 */
@Entity({ name: 'dim_ligne_metier' })
@Index('ix_dim_ligne_metier_parent', ['fkLigneMetierParent'])
@Index(
  'uq_dim_ligne_metier_business_date',
  ['codeLigneMetier', 'dateDebutValidite'],
  { unique: true },
)
export class DimLigneMetier extends Scd2Entity {
  @PrimaryGeneratedColumn('identity', { type: 'bigint' })
  id!: string;

  @Column({ name: 'code_ligne_metier', type: 'varchar', length: 50 })
  codeLigneMetier!: string;

  @Column({ name: 'libelle', type: 'varchar', length: 200 })
  libelle!: string;

  @Column({ name: 'fk_ligne_metier_parent', type: 'bigint', nullable: true })
  fkLigneMetierParent!: string | null;

  @Column({ name: 'niveau', type: 'int' })
  niveau!: number;

  @ManyToOne(() => DimLigneMetier, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'fk_ligne_metier_parent' })
  parent?: DimLigneMetier | null;
}
