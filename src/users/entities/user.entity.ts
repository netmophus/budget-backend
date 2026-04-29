import {
  Column,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { UserRole } from './user-role.entity';

@Entity({ name: 'user' })
export class User {
  @PrimaryGeneratedColumn('identity', { type: 'bigint' })
  id!: string;

  @Index('uq_user_email', { unique: true })
  @Column({ name: 'email', type: 'varchar', length: 255 })
  email!: string;

  @Column({ name: 'mot_de_passe_hash', type: 'varchar', length: 255 })
  motDePasseHash!: string;

  @Column({ name: 'nom', type: 'varchar', length: 100 })
  nom!: string;

  @Column({ name: 'prenom', type: 'varchar', length: 100 })
  prenom!: string;

  @Column({ name: 'est_actif', type: 'boolean', default: true })
  estActif!: boolean;

  @Column({
    name: 'date_derniere_connexion',
    type: 'timestamp',
    nullable: true,
  })
  dateDerniereConnexion!: Date | null;

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

  @OneToMany(() => UserRole, (userRole) => userRole.user)
  userRoles!: UserRole[];
}
