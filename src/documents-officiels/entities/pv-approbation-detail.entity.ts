/**
 * `pv_approbation_detail` — détail métier d'un PV d'approbation du
 * Conseil d'Administration (Lot 8.3.D).
 *
 * Relation 1-to-1 avec [[DocumentOfficiel]] : exactement 0 ou 1 ligne
 * par document de type D11_PV_APPROBATION (contrainte applicative
 * côté `PvApprobationService` + contrainte UNIQUE sur `fk_document`
 * côté DB).
 *
 * 5e type métier riche après D2 (lettre cadrage, Lot 8.2.C), D3 (note
 * orientation, Lot 8.3.A), D5 (lettre mobilisation, Lot 8.3.B) et D1
 * (note préparatoire DG, Lot 8.3.C). Exclusion mutuelle stricte entre
 * les 5 : un document a au plus UN détail métier riche non-null.
 *
 * **Position dans le cycle BSIC** : le PV CA est émis APRÈS la
 * signature de D2 (Lettre de cadrage) — il scelle l'approbation
 * formelle du budget par le Conseil d'Administration.
 *
 * Cycle complet : **D1 (Note préparatoire DG) → D3 (Orientation
 * Comité) → D2 (Cadrage Directeurs CR) → D5 (Mobilisation tous
 * Directeurs) → D11 (PV d'approbation CA)**.
 *
 * **2 colonnes TEXT TipTap** (ordreDuJourHtml + decisionsHtml) —
 * première table métier riche du projet avec 2 RichTextEditors
 * simultanés côté frontend. TipTap StarterKit émet du HTML sécurisé
 * par défaut.
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

@Entity({ name: 'pv_approbation_detail' })
@Index('idx_pad_fk_document', ['fkDocument'])
export class PvApprobationDetail {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'fk_document', type: 'uuid', unique: true })
  fkDocument!: string;

  @OneToOne(() => DocumentOfficiel)
  @JoinColumn({ name: 'fk_document' })
  document?: DocumentOfficiel;

  // ─── Identification du PV ───────────────────────────────────────

  @Column({
    name: 'numero_resolution',
    type: 'varchar',
    length: 50,
    nullable: true,
  })
  numeroResolution!: string | null;

  @Column({ name: 'date_seance_ca', type: 'date', nullable: true })
  dateSeanceCa!: Date | null;

  @Column({
    name: 'lieu_seance',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  lieuSeance!: string | null;

  // ─── Présidence de séance ───────────────────────────────────────

  @Column({
    name: 'president_seance',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  presidentSeance!: string | null;

  @Column({
    name: 'secretaire_seance',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  secretaireSeance!: string | null;

  // ─── Quorum ─────────────────────────────────────────────────────

  @Column({
    name: 'nb_administrateurs_presents',
    type: 'integer',
    nullable: true,
  })
  nbAdministrateursPresents!: number | null;

  @Column({
    name: 'nb_administrateurs_total',
    type: 'integer',
    nullable: true,
  })
  nbAdministrateursTotal!: number | null;

  @Column({ name: 'quorum_atteint', type: 'boolean', nullable: true })
  quorumAtteint!: boolean | null;

  // ─── Ordre du jour (HTML riche TipTap) ──────────────────────────

  @Column({ name: 'ordre_du_jour_html', type: 'text', nullable: true })
  ordreDuJourHtml!: string | null;

  // ─── Décisions adoptées (HTML riche TipTap) ─────────────────────

  @Column({ name: 'decisions_html', type: 'text', nullable: true })
  decisionsHtml!: string | null;

  // ─── Vote ───────────────────────────────────────────────────────

  @Column({
    name: 'vote_resultat',
    type: 'varchar',
    length: 50,
    nullable: true,
  })
  voteResultat!: 'UNANIMITE' | 'MAJORITE' | 'REJETE' | null;

  @Column({ name: 'commentaire_president', type: 'text', nullable: true })
  commentairePresident!: string | null;

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
