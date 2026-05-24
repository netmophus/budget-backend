/**
 * `lettre_mobilisation_detail` — détail métier d'une Lettre de
 * mobilisation DG → Directeurs BSIC (Lot 8.3.B).
 *
 * Relation 1-to-1 avec [[DocumentOfficiel]] : exactement 0 ou 1 ligne
 * par document de type D5_LETTRE_MOBILISATION (contrainte applicative
 * côté `LettreMobilisationService` + contrainte UNIQUE sur
 * `fk_document` côté DB).
 *
 * 3e type métier riche après D2 (lettre cadrage, Lot 8.2.C) et D3
 * (note orientation, Lot 8.3.A). Exclusion mutuelle entre les 3 :
 * un document est soit D2, soit D3, soit D5 (ou autre type sans
 * détail), jamais 2 à la fois.
 *
 * Différence métier vs D2/D3 :
 *  - D2 = lettre OFFICIELLE externe avec objectifs chiffrés (PNB,
 *    RN, ratios BCEAO) → Directeurs de CR
 *  - D3 = note INTERNE de Direction avec analyse macro + axes
 *    stratégiques + description riche HTML TipTap → Comité de Direction
 *  - **D5 = lettre MOTIVATIONNELLE de mobilisation après D2/D3, avec
 *    indicateurs de mobilisation + échéances + message DG → Directeurs
 *    (tous niveaux)**
 *
 * **Types NUMERIC** : pg renvoie en `string` pour préserver la
 * précision exacte (pattern projet aligné sur BIGINT user.id).
 *
 * **message_dg_html** : HTML généré par éditeur TipTap (frontend).
 * Stockage TEXT, validation `@MaxLength(10000)` côté DTO. TipTap
 * émet du HTML sécurisé par défaut.
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

@Entity({ name: 'lettre_mobilisation_detail' })
@Index('idx_lmd_fk_document', ['fkDocument'])
export class LettreMobilisationDetail {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'fk_document', type: 'uuid', unique: true })
  fkDocument!: string;

  @OneToOne(() => DocumentOfficiel)
  @JoinColumn({ name: 'fk_document' })
  document?: DocumentOfficiel;

  // ─── En-tête lettre officielle ──────────────────────────────────

  @Column({
    name: 'reference_lettre',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  referenceLettre!: string | null;

  @Column({ name: 'date_emission', type: 'date', nullable: true })
  dateEmission!: Date | null;

  @Column({
    name: 'destinataires_directions',
    type: 'varchar',
    length: 1000,
    nullable: true,
  })
  destinatairesDirections!: string | null;

  // ─── Période d'exécution ────────────────────────────────────────

  @Column({ name: 'exercice_concerne', type: 'integer', nullable: true })
  exerciceConcerne!: number | null;

  @Column({ name: 'date_debut_execution', type: 'date', nullable: true })
  dateDebutExecution!: Date | null;

  @Column({ name: 'date_fin_execution', type: 'date', nullable: true })
  dateFinExecution!: Date | null;

  // ─── Objectifs globaux BSIC NIGER (NUMERIC pg → string) ─────────

  @Column({
    name: 'pnb_consolide_mfcfa',
    type: 'numeric',
    precision: 15,
    scale: 2,
    nullable: true,
  })
  pnbConsolideMfcfa!: string | null;

  @Column({
    name: 'rn_consolide_mfcfa',
    type: 'numeric',
    precision: 15,
    scale: 2,
    nullable: true,
  })
  rnConsolideMfcfa!: string | null;

  @Column({
    name: 'croissance_credits_globale_pct',
    type: 'numeric',
    precision: 5,
    scale: 2,
    nullable: true,
  })
  croissanceCreditsGlobalePct!: string | null;

  @Column({
    name: 'croissance_depots_globale_pct',
    type: 'numeric',
    precision: 5,
    scale: 2,
    nullable: true,
  })
  croissanceDepotsGlobalePct!: string | null;

  // ─── Indicateurs de mobilisation ────────────────────────────────

  @Column({
    name: 'taux_participation_vise_pct',
    type: 'numeric',
    precision: 5,
    scale: 2,
    nullable: true,
  })
  tauxParticipationVisePct!: string | null;

  @Column({
    name: 'nb_objectifs_prioritaires',
    type: 'integer',
    nullable: true,
  })
  nbObjectifsPrioritaires!: number | null;

  @Column({
    name: 'taux_conformite_budgetaire_pct',
    type: 'numeric',
    precision: 5,
    scale: 2,
    nullable: true,
  })
  tauxConformiteBudgetairePct!: string | null;

  // ─── Échéances clés (5 jalons) ──────────────────────────────────

  @Column({
    name: 'date_reunion_mobilisation',
    type: 'date',
    nullable: true,
  })
  dateReunionMobilisation!: Date | null;

  @Column({
    name: 'date_debut_saisie_objectifs',
    type: 'date',
    nullable: true,
  })
  dateDebutSaisieObjectifs!: Date | null;

  @Column({
    name: 'date_premier_point_avancement',
    type: 'date',
    nullable: true,
  })
  datePremierPointAvancement!: Date | null;

  @Column({ name: 'date_validation_finale', type: 'date', nullable: true })
  dateValidationFinale!: Date | null;

  @Column({ name: 'date_communication_bceao', type: 'date', nullable: true })
  dateCommunicationBceao!: Date | null;

  // ─── Message du DG (HTML riche TipTap) ──────────────────────────

  @Column({ name: 'message_dg_html', type: 'text', nullable: true })
  messageDgHtml!: string | null;

  // ─── Engagement attendu ─────────────────────────────────────────

  @Column({ name: 'engagement_attendu', type: 'text', nullable: true })
  engagementAttendu!: string | null;

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
