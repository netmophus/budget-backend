import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { Scd2Entity } from '../../../common/entities/scd2.entity';

export type TypeStructure =
  | 'entite_juridique'
  | 'branche'
  | 'direction'
  | 'departement'
  | 'agence';

export const TYPES_STRUCTURE: readonly TypeStructure[] = [
  'entite_juridique',
  'branche',
  'direction',
  'departement',
  'agence',
];

export type CodePaysUemoa =
  | 'CIV'
  | 'SEN'
  | 'BEN'
  | 'BFA'
  | 'MLI'
  | 'NER'
  | 'TGO'
  | 'GNB';

export const CODES_PAYS_UEMOA: readonly CodePaysUemoa[] = [
  'CIV',
  'SEN',
  'BEN',
  'BFA',
  'MLI',
  'NER',
  'TGO',
  'GNB',
];

/**
 * Hiérarchie organisationnelle (cf. `docs/modele-donnees.md` §3.2).
 *
 * IMPORTANT — sémantique `fk_structure_parent` et SCD2 :
 *   `fk_structure_parent` pointe vers le **surrogate key** (id technique)
 *   du parent. Quand le parent reçoit une nouvelle version SCD2
 *   (`createNewVersion`), son `id` change. Les enfants existants pointent
 *   encore vers l'ancien id, ce qui est CORRECT : ils sont rattachés à la
 *   VERSION du parent valide à la date où le rattachement a été établi.
 *
 *   Lors d'une nouvelle version d'enfant (`createNewVersionStructure`),
 *   si la relation parent doit elle aussi être mise à jour (rattachement
 *   à la version COURANTE du parent), il faut explicitement passer le
 *   nouvel `id` parent dans les `attrs`. Sémantique cohérente avec
 *   `modele-donnees.md` §6.3.
 */
@Entity({ name: 'dim_structure' })
@Index('ix_dim_structure_parent', ['fkStructureParent'])
@Index('ix_dim_structure_code_pays', ['codePays'])
export class DimStructure extends Scd2Entity {
  @PrimaryGeneratedColumn('identity', { type: 'bigint' })
  id!: string;

  @Column({ name: 'code_structure', type: 'varchar', length: 50 })
  codeStructure!: string;

  @Column({ name: 'libelle', type: 'varchar', length: 200 })
  libelle!: string;

  @Column({ name: 'libelle_court', type: 'varchar', length: 50, nullable: true })
  libelleCourt!: string | null;

  @Column({ name: 'type_structure', type: 'varchar', length: 20 })
  typeStructure!: TypeStructure;

  @Column({ name: 'niveau_hierarchique', type: 'int' })
  niveauHierarchique!: number;

  @Column({ name: 'fk_structure_parent', type: 'bigint', nullable: true })
  fkStructureParent!: string | null;

  @Column({ name: 'code_pays', type: 'char', length: 3, nullable: true })
  codePays!: CodePaysUemoa | null;

  @ManyToOne(() => DimStructure, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'fk_structure_parent' })
  parent?: DimStructure | null;
}
