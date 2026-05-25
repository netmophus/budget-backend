/**
 * `note_preparatoire_detail` — détail métier d'une Note préparatoire
 * DG (Lot 8.3.C).
 *
 * Relation 1-to-1 avec [[DocumentOfficiel]] : exactement 0 ou 1 ligne
 * par document de type D1_NOTE_PREPARATOIRE (contrainte applicative
 * côté `NotePreparatoireService` + contrainte UNIQUE sur `fk_document`
 * côté DB).
 *
 * 4e type métier riche après D2 (lettre cadrage, Lot 8.2.C), D3 (note
 * orientation, Lot 8.3.A) et D5 (lettre mobilisation, Lot 8.3.B).
 * Exclusion mutuelle stricte entre les 4 : un document est soit D1,
 * soit D2, soit D3, soit D5 (ou autre type sans détail), jamais 2 à
 * la fois.
 *
 * **Position dans le cycle BSIC** : la Note préparatoire DG est émise
 * par le DG AVANT la réunion du Comité (en début de cycle budgétaire)
 * pour poser le contexte et l'ordre du jour de la réunion qui donnera
 * ensuite naissance à D3 puis D2 puis D5.
 *
 * Cycle complet : **D1 (Note préparatoire DG) → D3 (Orientation
 * Comité) → D2 (Cadrage Directeurs CR) → D5 (Mobilisation tous
 * Directeurs)**.
 *
 * **ordre_du_jour_html** : HTML généré par éditeur TipTap (frontend).
 * Stockage TEXT, validation `@MaxLength(10000)` côté DTO. TipTap émet
 * du HTML sécurisé par défaut.
 */
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { DocumentOfficiel } from './document-officiel.entity';

@Entity({ name: 'note_preparatoire_detail' })
@Index('idx_npd_fk_document', ['fkDocument'])
export class NotePreparatoireDetail {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'fk_document', type: 'uuid', unique: true })
  fkDocument!: string;

  @OneToOne(() => DocumentOfficiel)
  @JoinColumn({ name: 'fk_document' })
  document?: DocumentOfficiel;

  // ─── En-tête note préparatoire ──────────────────────────────────

  @Column({
    name: 'reference_note',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  referenceNote!: string | null;

  @Column({ name: 'date_emission', type: 'date', nullable: true })
  dateEmission!: Date | null;

  @Column({
    name: 'date_convocation_comite',
    type: 'date',
    nullable: true,
  })
  dateConvocationComite!: Date | null;

  @Column({
    name: 'lieu_reunion',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  lieuReunion!: string | null;

  // ─── Participants convoqués (texte multi-lignes) ────────────────

  @Column({
    name: 'participants_convoques',
    type: 'varchar',
    length: 2000,
    nullable: true,
  })
  participantsConvoques!: string | null;

  // ─── Exercice budgétaire concerné ───────────────────────────────

  @Column({ name: 'exercice_concerne', type: 'integer', nullable: true })
  exerciceConcerne!: number | null;

  @Column({
    name: 'date_debut_preparation',
    type: 'date',
    nullable: true,
  })
  dateDebutPreparation!: Date | null;

  @Column({
    name: 'date_butoir_preparation',
    type: 'date',
    nullable: true,
  })
  dateButoirPreparation!: Date | null;

  // ─── Ordre du jour (HTML riche TipTap) ──────────────────────────

  @Column({ name: 'ordre_du_jour_html', type: 'text', nullable: true })
  ordreDuJourHtml!: string | null;

  // ─── Documents pré-lus attendus (texte multi-lignes) ────────────

  @Column({
    name: 'documents_pre_lus',
    type: 'varchar',
    length: 2000,
    nullable: true,
  })
  documentsPreLus!: string | null;

  // ─── Points clés à débattre ─────────────────────────────────────

  @Column({ name: 'points_cles_debattre', type: 'text', nullable: true })
  pointsClesDebattre!: string | null;

  // ─── Décisions attendues ────────────────────────────────────────

  @Column({ name: 'decisions_attendues', type: 'text', nullable: true })
  decisionsAttendues!: string | null;

  // ─── Audit ──────────────────────────────────────────────────────

  @CreateDateColumn({ name: 'date_creation', type: 'timestamp' })
  dateCreation!: Date;

  @UpdateDateColumn({
    name: 'date_modification',
    type: 'timestamp',
    nullable: true,
  })
  dateModification!: Date | null;

  @Column({ name: 'utilisateur_creation', type: 'varchar', length: 255 })
  utilisateurCreation!: string;

  @Column({
    name: 'utilisateur_modification',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  utilisateurModification!: string | null;
}
