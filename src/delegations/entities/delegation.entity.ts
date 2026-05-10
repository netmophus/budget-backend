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

export type PermissionDelegable =
  | 'SAISIE'
  | 'SOUMISSION'
  | 'VALIDATION'
  | 'PUBLICATION';

/**
 * `delegations` (Lot 4.2) — délégation temporaire de droits d'un
 * délégant à un délégataire sur un sous-ensemble de ses
 * `user_perimetres`, pour une période bornée. La table est en
 * AOF (Append-Only-Function) : pas de DELETE physique, soft via
 * `actif=false` + `revoquee_le` ou expiration auto cron.
 *
 * Anti-chaînage strict (D2) : la contrainte vit côté service via
 * `user_perimetres.origine`. Pas de contrainte SQL — vérifier
 * `DelegationService.creer` qui rejette si une affectation
 * source provient déjà d'une délégation.
 */
@Entity({ name: 'delegations' })
@Index('idx_delegations_delegant_actif', ['fkDelegant', 'actif'])
@Index('idx_delegations_delegataire_actif', ['fkDelegataire', 'actif'])
@Check('chk_delegation_diff_users_check', `"fk_delegant" <> "fk_delegataire"`)
@Check('chk_delegation_dates_check', `"date_fin" >= "date_debut"`)
export class Delegation {
  @PrimaryGeneratedColumn('identity', { type: 'bigint' })
  id!: string;

  @Column({ name: 'fk_delegant', type: 'bigint' })
  fkDelegant!: string;

  @Column({ name: 'fk_delegataire', type: 'bigint' })
  fkDelegataire!: string;

  @Column({
    name: 'perimetre_user_perimetre_ids',
    type: 'bigint',
    array: true,
  })
  perimetreUserPerimetreIds!: string[];

  @Column({ name: 'permissions', type: 'text', array: true })
  permissions!: PermissionDelegable[];

  @Column({ name: 'motif', type: 'text' })
  motif!: string;

  @Column({ name: 'date_debut', type: 'date' })
  dateDebut!: string;

  @Column({ name: 'date_fin', type: 'date' })
  dateFin!: string;

  @Column({ name: 'actif', type: 'boolean', default: true })
  actif!: boolean;

  @Column({ name: 'revoquee_le', type: 'timestamp', nullable: true })
  revoqueeLe!: Date | null;

  @Column({ name: 'fk_revoque_par', type: 'bigint', nullable: true })
  fkRevoquePar!: string | null;

  @Column({ name: 'motif_revocation', type: 'text', nullable: true })
  motifRevocation!: string | null;

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

  /**
   * Lot 6.5.B — date du dernier envoi du rappel J-3 (cron quotidien
   * 06:00). NULL = jamais notifié pour cette délégation. Le cron
   * filtre `derniere_notification_j3 IS NULL AND date_fin = today + 3
   * jours AND actif = true` pour idempotencer les exécutions
   * multiples le même jour.
   */
  @Column({
    name: 'derniere_notification_j3',
    type: 'timestamp',
    nullable: true,
  })
  derniereNotificationJ3!: Date | null;

  @Column({ name: 'date_modification', type: 'timestamp', nullable: true })
  dateModification!: Date | null;

  @Column({
    name: 'utilisateur_modification',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  utilisateurModification!: string | null;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'fk_delegant' })
  delegant!: User;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'fk_delegataire' })
  delegataire!: User;
}
