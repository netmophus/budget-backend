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
// Index unique métier (codeStructure, dateDebutValidite) — en métadata
// d'entité pour que `synchronize:true` (tests pg-mem) le crée aussi,
// pas seulement la migration. Cf. fix 2.3A.1.
@Index('uq_dim_structure_business_date', ['codeStructure', 'dateDebutValidite'], { unique: true })
// Index unique partiel `uq_dim_structure_courante (codeStructure)
// WHERE version_courante = true` : créé par la migration
// `CreateDimStructure1777800000000` mais PAS déclaré ici comme @Index
// avec `where:` car pg-mem 3.x interprète mal la clause (crée un
// unique full sur codeStructure, ce qui interdit l'historique SCD2 et
// fait planter le 2ᵉ rawInsert d'un même code). En Postgres réel
// l'index partiel est en place via la migration. L'invariant
// « 1 seule version courante par BK » est porté en runtime par
// `Scd2Service.createNewVersion` (ferme l'ancienne avant d'insérer la
// nouvelle, transactionnellement).
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
