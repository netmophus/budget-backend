import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Role } from '../../roles/entities/role.entity';
import { User } from './user.entity';

@Entity({ name: 'bridge_user_role' })
@Index('ix_bridge_user_role_user', ['fkUser'])
@Index('ix_bridge_user_role_role', ['fkRole'])
@Check(
  'ck_bridge_user_role_perimetre_type',
  `"perimetre_type" IS NULL OR "perimetre_type" IN ('global','structure','centre_responsabilite')`,
)
export class UserRole {
  @PrimaryGeneratedColumn('identity', { type: 'bigint' })
  id!: string;

  @Column({ name: 'fk_user', type: 'bigint' })
  fkUser!: string;

  @Column({ name: 'fk_role', type: 'bigint' })
  fkRole!: string;

  // Lot 3.3 : étendu varchar(20) → varchar(50) car la valeur
  // 'centre_responsabilite' (21 chars) acceptée par le CHECK ne tenait
  // pas dans la colonne (cf. migration 1779200000020).
  @Column({
    name: 'perimetre_type',
    type: 'varchar',
    length: 50,
    nullable: true,
  })
  perimetreType!: string | null;

  @Column({ name: 'perimetre_id', type: 'bigint', nullable: true })
  perimetreId!: string | null;

  @Column({ name: 'date_debut_validite', type: 'date', nullable: true })
  dateDebutValidite!: string | null;

  @Column({ name: 'date_fin_validite', type: 'date', nullable: true })
  dateFinValidite!: string | null;

  @Column({ name: 'est_actif', type: 'boolean', default: true })
  estActif!: boolean;

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

  @ManyToOne(() => User, (user) => user.userRoles, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'fk_user' })
  user!: User;

  @ManyToOne(() => Role, (role) => role.userRoles, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'fk_role' })
  role!: Role;
}
