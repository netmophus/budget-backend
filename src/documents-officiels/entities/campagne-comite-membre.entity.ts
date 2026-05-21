/**
 * `campagne_comite_membre` — Membre du Comité visa nominé sur une
 * campagne (Lot 8.1.A).
 *
 * Cardinalité N depuis [[CampagneBudgetaire]]. Chaque ligne = un user
 * désigné par le DG pour viser les documents officiels de cette
 * campagne. La contrainte `uq_camp_user` garantit qu'un user n'est
 * nominé qu'une fois par campagne.
 *
 * `ordre` permet le mode SEQUENTIEL (visa 1 puis visa 2 puis ...) ;
 * en mode PARALLELE, l'ordre est purement décoratif.
 */
import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

import { User } from '../../users/entities/user.entity';
import { CampagneBudgetaire } from './campagne-budgetaire.entity';

@Entity({ name: 'campagne_comite_membre' })
@Index('idx_comite_campagne', ['fkCampagne'])
@Index('idx_comite_user', ['fkUser'])
@Unique('uq_camp_user', ['fkCampagne', 'fkUser'])
export class CampagneComiteMembre {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'fk_campagne', type: 'uuid' })
  fkCampagne!: string;

  @ManyToOne(() => CampagneBudgetaire, (c) => c.comiteMembres, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'fk_campagne' })
  campagne?: CampagneBudgetaire;

  @Column({ name: 'fk_user', type: 'bigint' })
  fkUser!: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'fk_user' })
  user?: User;

  @Column({ name: 'ordre', type: 'integer', default: 1 })
  ordre!: number;

  @Column({ name: 'est_obligatoire', type: 'boolean', default: true })
  estObligatoire!: boolean;

  @Column({
    name: 'libelle_fonction',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  libelleFonction!: string | null;

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
  })
  utilisateurCreation!: string;
}
