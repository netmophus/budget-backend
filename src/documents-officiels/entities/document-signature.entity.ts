/**
 * `document_signature` — Empreinte cryptographique d'un document signé
 * (Lot 8.1.A).
 *
 * Cardinalité 0..1 depuis [[DocumentOfficiel]] (contrainte UNIQUE sur
 * `fk_document`). Une seule signature finale possible.
 *
 * Capture au moment exact de la signature :
 *  - `hash_contenu` : SHA-256 du `document_officiel.contenu_html`
 *  - `hash_visas` : SHA-256 de la concaténation canonique des visas
 *    (figés au moment du passage VISE → SIGNE)
 *  - contexte d'auth : IP, user-agent, méthode (PASSWORD / MFA / ...)
 *  - `nom_signataire` + `email_signataire` : copie au moment de la
 *    signature (résistance au changement de nom/email du user après)
 *  - `fk_audit_log` : lien vers l'entrée audit_log (réglementaire BCEAO)
 *
 * `ON DELETE RESTRICT` sur fk_document : un document signé ne peut PAS
 * être supprimé (conservation 10 ans).
 */
import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { AuditLog } from '../../audit/entities/audit-log.entity';
import { User } from '../../users/entities/user.entity';
import { DocumentOfficiel } from './document-officiel.entity';

export type MethodeAuthentification = 'PASSWORD' | 'MFA' | 'CERTIFICAT';

@Entity({ name: 'document_signature' })
@Index('idx_signature_user', ['fkUserSignataire'])
@Index('idx_signature_audit', ['fkAuditLog'])
export class DocumentSignature {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'fk_document', type: 'uuid', unique: true })
  fkDocument!: string;

  @OneToOne(() => DocumentOfficiel, (d) => d.signature, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'fk_document' })
  document?: DocumentOfficiel;

  @Column({ name: 'fk_user_signataire', type: 'bigint' })
  fkUserSignataire!: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'fk_user_signataire' })
  signataire?: User;

  @Column({ name: 'email_signataire', type: 'varchar', length: 255 })
  emailSignataire!: string;

  @Column({ name: 'nom_signataire', type: 'varchar', length: 255 })
  nomSignataire!: string;

  @Column({ name: 'hash_contenu', type: 'varchar', length: 64 })
  hashContenu!: string;

  @Column({ name: 'hash_visas', type: 'varchar', length: 64 })
  hashVisas!: string;

  @Column({ name: 'ip_signature', type: 'varchar', length: 45, nullable: true })
  ipSignature!: string | null;

  @Column({ name: 'user_agent_signature', type: 'text', nullable: true })
  userAgentSignature!: string | null;

  @Column({
    name: 'methode_authentification',
    type: 'varchar',
    length: 50,
    default: 'PASSWORD',
  })
  methodeAuthentification!: MethodeAuthentification;

  @Column({
    name: 'date_signature',
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
  })
  dateSignature!: Date;

  @Column({ name: 'fk_audit_log', type: 'bigint', nullable: true })
  fkAuditLog!: string | null;

  @ManyToOne(() => AuditLog)
  @JoinColumn({ name: 'fk_audit_log' })
  auditLog?: AuditLog;
}
