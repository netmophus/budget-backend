/**
 * PasswordResetToken (Lot 6.5.A) — entité TypeORM pour la table
 * `password_reset_token` (cf. migration 1779200000200).
 *
 * Le champ `token` contient le hash SHA-256 (hex 64 caractères) du
 * jeton clair généré côté serveur. Le jeton clair n'est jamais
 * persisté en base — il transite uniquement dans l'email envoyé via
 * la queue BullMQ. Pour valider une demande de reset, le service
 * recalcule le hash du jeton reçu et le compare avec ce champ.
 */
import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

@Entity({ name: 'password_reset_token' })
@Index('ix_password_reset_token_user', ['fkUser'])
@Index('ix_password_reset_token_expiration', ['dateExpiration'])
export class PasswordResetToken {
  @PrimaryGeneratedColumn('identity', { type: 'bigint' })
  id!: string;

  @Column({ name: 'fk_user', type: 'bigint' })
  fkUser!: string;

  @Index('ux_password_reset_token_token', { unique: true })
  @Column({ name: 'token', type: 'varchar', length: 64 })
  token!: string;

  @Column({ name: 'date_expiration', type: 'timestamp' })
  dateExpiration!: Date;

  @Column({ name: 'utilise', type: 'boolean', default: false })
  utilise!: boolean;

  @Column({
    name: 'date_creation',
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
  })
  dateCreation!: Date;

  @Column({ name: 'utilisateur_creation', type: 'varchar', length: 255 })
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
