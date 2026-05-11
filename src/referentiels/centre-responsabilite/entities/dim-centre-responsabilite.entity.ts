import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { Scd2Entity } from '../../../common/entities/scd2.entity';
import { DimStructure } from '../../structure/entities/dim-structure.entity';

export type TypeCr = 'cdc' | 'cdp' | 'cdr' | 'autre';

export const TYPES_CR: readonly TypeCr[] = ['cdc', 'cdp', 'cdr', 'autre'];

/**
 * `dim_centre_responsabilite` — maille de saisie budgétaire (cf.
 * `docs/modele-donnees.md` §3.3).
 *
 * IMPORTANT — sémantique `fk_structure` (stratégie A, cf.
 * `scd2-pattern.md` §8) :
 *   La FK pointe vers la **version courante** de la structure
 *   parente. Quand la structure reçoit une nouvelle version SCD2,
 *   un hook applicatif (`StructureService.update` →
 *   `CentreResponsabiliteService.relinkAfterStructureRevision`)
 *   met à jour la FK de TOUS les CR (toutes versions) pour qu'elle
 *   pointe vers le nouvel `id`. Le CR ne crée PAS de nouvelle
 *   version SCD2 lors d'un relink — il n'a pas d'historique de
 *   rattachement propre.
 */
@Entity({ name: 'dim_centre_responsabilite' })
@Index('ix_dim_cr_structure', ['fkStructure'])
@Index('ix_dim_cr_type_cr', ['typeCr'])
@Index('uq_dim_cr_business_date', ['codeCr', 'dateDebutValidite'], {
  unique: true,
})
export class DimCentreResponsabilite extends Scd2Entity {
  @PrimaryGeneratedColumn('identity', { type: 'bigint' })
  id!: string;

  @Column({ name: 'code_cr', type: 'varchar', length: 50 })
  codeCr!: string;

  @Column({ name: 'libelle', type: 'varchar', length: 200 })
  libelle!: string;

  @Column({
    name: 'libelle_court',
    type: 'varchar',
    length: 50,
    nullable: true,
  })
  libelleCourt!: string | null;

  @Column({ name: 'type_cr', type: 'varchar', length: 20 })
  typeCr!: TypeCr;

  @Column({ name: 'fk_structure', type: 'bigint' })
  fkStructure!: string;

  @ManyToOne(() => DimStructure, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'fk_structure' })
  structure?: DimStructure;
}
