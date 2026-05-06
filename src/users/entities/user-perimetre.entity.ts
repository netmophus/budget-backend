import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { User } from './user.entity';

export type CiblePerimetreType = 'STRUCTURE' | 'CR' | 'CR_SET';
export type OriginePerimetre = 'PRINCIPAL' | 'AFFECTATION' | 'DELEGATION';

/**
 * `user_perimetres` (Lot 4.1.A) — affectation N-N user ↔ périmètre
 * budgétaire avec dates d'effet et 3 cible_type :
 *
 *  - STRUCTURE : descente d'arborescence (recursive — BFS itératif
 *    côté service car pg-mem ne supporte pas WITH RECURSIVE)
 *  - CR        : un seul centre de responsabilité (pas de descente)
 *  - CR_SET    : liste explicite de ≥ 2 CR (pas de descente)
 *
 * Cohérence garantie par la contrainte SQL `ck_user_perimetres_cible_coherence` :
 *   - STRUCTURE | CR  → cible_id NOT NULL, cible_cr_ids NULL
 *   - CR_SET          → cible_id NULL, cible_cr_ids NOT NULL avec ≥ 2 éléments
 *
 * `delegation_id` sera FK vers la table `delegations` au Lot 4.2.
 */
@Entity({ name: 'user_perimetres' })
@Index('idx_user_perimetres_user_actif', ['fkUser', 'actif'])
@Index('idx_user_perimetres_cible', ['cibleType', 'cibleId'])
@Check(
  'ck_user_perimetres_cible_type_check',
  `"cible_type" IN ('STRUCTURE','CR','CR_SET')`,
)
export class UserPerimetre {
  @PrimaryGeneratedColumn('identity', { type: 'bigint' })
  id!: string;

  @Column({ name: 'fk_user', type: 'bigint' })
  fkUser!: string;

  @Column({ name: 'cible_type', type: 'varchar', length: 20 })
  cibleType!: CiblePerimetreType;

  @Column({ name: 'cible_id', type: 'bigint', nullable: true })
  cibleId!: string | null;

  /**
   * Liste des id de CR pour `cible_type='CR_SET'`. NULL pour STRUCTURE/CR.
   * Le tableau est typé `bigint[]` côté Postgres ; node-postgres retourne
   * `string[]` côté JS (les bigint sont sérialisés en string par défaut).
   */
  @Column({
    name: 'cible_cr_ids',
    type: 'bigint',
    array: true,
    nullable: true,
  })
  cibleCrIds!: string[] | null;

  @Column({ name: 'origine', type: 'varchar', length: 30, default: 'PRINCIPAL' })
  origine!: OriginePerimetre;

  @Column({ name: 'delegation_id', type: 'bigint', nullable: true })
  delegationId!: string | null;

  // NB : `default: () => 'CURRENT_DATE'` retiré côté entité car
  // pg-mem interprète mal le DEFAULT généré par TypeORM
  // (`('now'::text)::date`). Le DEFAULT existe côté SQL via la
  // migration ; les services fournissent toujours dateDebut à
  // l'INSERT.
  @Column({ name: 'date_debut', type: 'date' })
  dateDebut!: string;

  @Column({ name: 'date_fin', type: 'date', nullable: true })
  dateFin!: string | null;

  @Column({ name: 'actif', type: 'boolean', default: true })
  actif!: boolean;

  @Column({ name: 'motif', type: 'text', nullable: true })
  motif!: string | null;

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

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'fk_user' })
  user!: User;
}
