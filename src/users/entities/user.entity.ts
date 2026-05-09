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

  // Lot 6.4.A — Expiration mot de passe (default 90 jours).
  // NULL = pas d'expiration (cas des users créés avant le Lot 6.4).
  @Column({
    name: 'date_expiration_mdp',
    type: 'timestamp',
    nullable: true,
  })
  dateExpirationMdp!: Date | null;

  // Lot 6.4.A — Force change après reset admin ou pour la 1ère
  // connexion. Tant que vrai, l'API bloque toutes les routes sauf
  // PATCH /me/password (cf. PasswordExpiredGuard).
  @Column({
    name: 'doit_changer_mdp',
    type: 'boolean',
    default: false,
  })
  doitChangerMdp!: boolean;

  // Lot 4.3 — Préférences notifications email.
  @Column({
    name: 'notifications_email_actives',
    type: 'boolean',
    default: true,
  })
  notificationsEmailActives!: boolean;

  /**
   * Liste blanche d'événements acceptés. NULL = tous les types acceptés
   * (défaut). Valeurs possibles : BUDGET_SOUMIS, BUDGET_VALIDE,
   * BUDGET_REJETE, BUDGET_PUBLIE, DELEGATION_CREEE, DELEGATION_EXPIREE,
   * DELEGATION_REVOQUEE, AFFECTATION_CREEE.
   */
  @Column({
    name: 'notifications_email_types',
    type: 'text',
    array: true,
    nullable: true,
  })
  notificationsEmailTypes!: string[] | null;

  @OneToMany(() => UserRole, (userRole) => userRole.user)
  userRoles!: UserRole[];
}
