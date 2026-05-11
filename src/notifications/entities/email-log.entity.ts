import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { User } from '../../users/entities/user.entity';

/**
 * Statuts d'un envoi d'email :
 *  - EN_ATTENTE : job publié dans la queue BullMQ, en attente du worker (Lot 6.3)
 *  - EN_COURS   : worker a pris le job, envoi SMTP en cours (Lot 6.3)
 *  - ENVOYE     : envoi SMTP réussi
 *  - ECHEC      : toutes les retries BullMQ ont échoué (terminal)
 *  - SUPPRIME   : email non envoyé volontairement (dry-run global, ou
 *                 préférence user désactivée). Trace conservée pour audit.
 */
export type StatutEmail =
  | 'EN_ATTENTE'
  | 'EN_COURS'
  | 'ENVOYE'
  | 'ECHEC'
  | 'SUPPRIME';

/**
 * Événements supportés par le module notifications (Lot 4.3).
 * Le mandat conserve la numérotation E1-E9 du prompt global,
 * E6 (rappel délégation J-3) volontairement reporté Lot 6.
 */
export type TypeEvenement =
  | 'BUDGET_SOUMIS' // E1
  | 'BUDGET_VALIDE' // E2
  | 'BUDGET_REJETE' // E3
  | 'BUDGET_PUBLIE' // E4
  | 'DELEGATION_CREEE' // E5
  | 'DELEGATION_EXPIREE' // E7
  | 'DELEGATION_REVOQUEE' // E8
  | 'AFFECTATION_CREEE' // E9
  // Lot 6.4.C — reset password admin (mdp temporaire envoyé par email).
  // Le mdp transite en clair dans le payload BullMQ + le mail SMTP, mais
  // n'apparaît JAMAIS dans email_log.payload (cf. EmailJobData.secrets).
  | 'RESET_PASSWORD_ADMIN' // E10
  // Lot 6.5.A — forgot password self-service. Le user a demandé un
  // lien de réinitialisation sur /auth/forgot-password ; le token
  // (en clair dans le lien) transite via EmailJobData.secrets
  // (jamais persisté en email_log.payload).
  | 'RESET_PASSWORD_SELF_SERVICE' // E11
  // Lot 6.5.B — rappel J-3 expiration délégation. Cron quotidien
  // 06:00 ; 1 ligne email_log par destinataire (donc 2 par
  // délégation : 1 délégant + 1 délégataire).
  | 'DELEGATION_RAPPEL_J3_DELEGANT' // E12
  | 'DELEGATION_RAPPEL_J3_DELEGATAIRE'; // E13

/**
 * email_log (Lot 4.3) — trace de chaque envoi d'email (réel ou
 * dry-run ou supprimé par préférence). Append-only : pas de
 * DELETE, pas d'UPDATE en dehors du retry.
 *
 * Le snapshot `destinataire_email` est conservé indépendamment de
 * `fk_destinataire` pour rester lisible même si le user est
 * supprimé (FK ON DELETE SET NULL).
 */
@Entity({ name: 'email_log' })
@Index('idx_email_log_statut', ['statut'])
@Index('idx_email_log_destinataire', ['fkDestinataire', 'dateCreation'])
@Index('idx_email_log_evenement', ['evenement', 'dateCreation'])
export class EmailLog {
  @PrimaryGeneratedColumn('identity', { type: 'bigint' })
  id!: string;

  @Column({ name: 'evenement', type: 'varchar', length: 64 })
  evenement!: TypeEvenement;

  @Column({ name: 'fk_destinataire', type: 'bigint', nullable: true })
  fkDestinataire!: string | null;

  @Column({ name: 'destinataire_email', type: 'varchar', length: 255 })
  destinataireEmail!: string;

  @Column({ name: 'sujet', type: 'text' })
  sujet!: string;

  @Column({ name: 'template', type: 'varchar', length: 64 })
  template!: string;

  @Column({ name: 'payload', type: 'jsonb', default: () => "'{}'::jsonb" })
  payload!: Record<string, unknown>;

  @Column({ name: 'statut', type: 'varchar', length: 20 })
  statut!: StatutEmail;

  @Column({ name: 'tentatives', type: 'int', default: 0 })
  tentatives!: number;

  @Column({ name: 'dernier_message_erreur', type: 'text', nullable: true })
  dernierMessageErreur!: string | null;

  @Column({ name: 'envoye_le', type: 'timestamp', nullable: true })
  envoyeLe!: Date | null;

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

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'fk_destinataire' })
  destinataire!: User | null;
}
