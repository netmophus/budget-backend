import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { Scd2Entity } from '../../../common/entities/scd2.entity';

export type SensCompte = 'D' | 'C' | 'M';

/**
 * `dim_compte` — Plan Comptable Bancaire **Révisé** de l'UMOA
 * (cf. `docs/modele-donnees.md` §3.4). Hiérarchie 4 niveaux,
 * SCD2 historisée.
 *
 * Stratégie A (lien vivant) sur la FK auto-référente
 * `fk_compte_parent` (cf. `scd2-pattern.md` §8) : quand un compte
 * parent reçoit une nouvelle version SCD2, ses enfants sont
 * automatiquement re-pointés vers le nouvel `id` via le hook
 * `CompteService.relinkAfterCompteRevision`. Pas de `forwardRef`
 * nécessaire : l'auto-référence reste interne au module.
 */
@Entity({ name: 'dim_compte' })
@Index('ix_dim_compte_parent', ['fkCompteParent'])
@Index('ix_dim_compte_classe', ['classe'])
@Index('ix_dim_compte_collectif', ['estCompteCollectif'])
@Index('uq_dim_compte_business_date', ['codeCompte', 'dateDebutValidite'], {
  unique: true,
})
export class DimCompte extends Scd2Entity {
  @PrimaryGeneratedColumn('identity', { type: 'bigint' })
  id!: string;

  @Column({ name: 'code_compte', type: 'varchar', length: 20 })
  codeCompte!: string;

  @Column({ name: 'libelle', type: 'varchar', length: 200 })
  libelle!: string;

  /**
   * Classe PCB UMOA (1..9). Type `varchar(50)` depuis 2.5-bis-B —
   * cohérent avec `ref_classe_compte.code`. FK active à partir de
   * la migration 1779100000050.
   */
  @Column({ name: 'classe', type: 'varchar', length: 50 })
  classe!: string;

  @Column({ name: 'sous_classe', type: 'varchar', length: 20, nullable: true })
  sousClasse!: string | null;

  @Column({ name: 'fk_compte_parent', type: 'bigint', nullable: true })
  fkCompteParent!: string | null;

  @Column({ name: 'niveau', type: 'int' })
  niveau!: number;

  @Column({ name: 'sens', type: 'char', length: 1, nullable: true })
  sens!: SensCompte | null;

  @Column({
    name: 'code_poste_budgetaire',
    type: 'varchar',
    length: 50,
    nullable: true,
  })
  codePosteBudgetaire!: string | null;

  @Column({ name: 'est_compte_collectif', type: 'boolean', default: false })
  estCompteCollectif!: boolean;

  @Column({ name: 'est_porteur_interets', type: 'boolean', default: false })
  estPorteurInterets!: boolean;

  @ManyToOne(() => DimCompte, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'fk_compte_parent' })
  parent?: DimCompte | null;
}
