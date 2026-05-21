/**
 * `document_visa` — Snapshot du Comité visa sur un document (Lot 8.1.A).
 *
 * Cardinalité N depuis [[DocumentOfficiel]]. Au moment où un document
 * passe de BROUILLON → SOUMIS_VISA, une ligne `document_visa` est
 * créée pour chaque membre du Comité actif sur la campagne. La
 * composition est FIGÉE à ce moment-là — pratique bancaire courante
 * pour préserver la traçabilité même si le Comité évolue après.
 *
 * Cycle individuel du visa : EN_ATTENTE → VISE | REJETE | IGNORE.
 * La contrainte CHECK `ck_visa_commentaire_si_rejet` force un motif
 * de rejet (REJETE sans commentaire = BadRequest applicatif).
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
import { DocumentOfficiel } from './document-officiel.entity';

export type StatutVisa = 'EN_ATTENTE' | 'VISE' | 'REJETE' | 'IGNORE';

@Entity({ name: 'document_visa' })
@Index('idx_visa_document', ['fkDocument'])
@Index('idx_visa_user', ['fkUserViseur'])
@Index('idx_visa_statut', ['statut'])
@Unique('uq_visa_doc_user', ['fkDocument', 'fkUserViseur'])
export class DocumentVisa {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'fk_document', type: 'uuid' })
  fkDocument!: string;

  @ManyToOne(() => DocumentOfficiel, (d) => d.visas, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'fk_document' })
  document?: DocumentOfficiel;

  @Column({ name: 'fk_user_viseur', type: 'bigint' })
  fkUserViseur!: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'fk_user_viseur' })
  viseur?: User;

  @Column({ name: 'ordre_visa', type: 'integer', default: 1 })
  ordreVisa!: number;

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
    name: 'statut',
    type: 'varchar',
    length: 20,
    default: 'EN_ATTENTE',
  })
  statut!: StatutVisa;

  @Column({
    name: 'date_demande',
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
  })
  dateDemande!: Date;

  @Column({ name: 'date_action', type: 'timestamp', nullable: true })
  dateAction!: Date | null;

  @Column({ name: 'commentaire', type: 'text', nullable: true })
  commentaire!: string | null;
}
