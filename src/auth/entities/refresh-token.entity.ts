import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

export type MotifRevocation = 'logout' | 'rotation' | 'forced';

@Entity({ name: 'refresh_token' })
@Index('ix_refresh_token_user', ['fkUser'])
@Check(
  'ck_refresh_token_motif',
  `"motif_revocation" IS NULL OR "motif_revocation" IN ('logout','rotation','forced')`,
)
export class RefreshToken {
  @PrimaryGeneratedColumn('identity', { type: 'bigint' })
  id!: string;

  @Column({ name: 'fk_user', type: 'bigint' })
  fkUser!: string;

  @Index('uq_refresh_token_hash', { unique: true })
  @Column({ name: 'token_hash', type: 'varchar', length: 255 })
  tokenHash!: string;

  @Column({ name: 'date_expiration', type: 'timestamp' })
  dateExpiration!: Date;

  @Column({ name: 'date_revocation', type: 'timestamp', nullable: true })
  dateRevocation!: Date | null;

  @Column({
    name: 'motif_revocation',
    type: 'varchar',
    length: 50,
    nullable: true,
  })
  motifRevocation!: MotifRevocation | null;

  @Column({ name: 'ip_emission', type: 'varchar', length: 45, nullable: true })
  ipEmission!: string | null;

  @Column({ name: 'user_agent', type: 'varchar', length: 500, nullable: true })
  userAgent!: string | null;

  @Column({
    name: 'date_creation',
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
  })
  dateCreation!: Date;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'fk_user' })
  user!: User;
}
