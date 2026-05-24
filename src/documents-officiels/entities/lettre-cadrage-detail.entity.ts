/**
 * `lettre_cadrage_detail` — détail métier d'une Lettre de cadrage
 * BSIC (Lot 8.2.C).
 *
 * Relation 1-to-1 avec [[DocumentOfficiel]] : exactement 0 ou 1 ligne
 * par document de type D2_LETTRE_CADRAGE (contrainte applicative côté
 * `LettreCadrageService` + contrainte UNIQUE sur `fk_document` côté DB).
 *
 * Affine le générique `document_officiel.contenu_html` (texte libre)
 * en données structurées requêtables : objectifs chiffrés (PNB, RN,
 * croissances, ratios), calendrier (5 jalons), orientations
 * stratégiques.
 *
 * **Types NUMERIC** : pg renvoie les NUMERIC en `string` pour
 * préserver la précision exacte (cf. pattern projet aligné sur les
 * BIGINT user.id). Le frontend les affiche tels quels ou parse avec
 * `parseFloat` uniquement pour comparaisons.
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

@Entity({ name: 'lettre_cadrage_detail' })
@Index('idx_lcd_fk_document', ['fkDocument'])
export class LettreCadrageDetail {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'fk_document', type: 'uuid', unique: true })
  fkDocument!: string;

  @OneToOne(() => DocumentOfficiel)
  @JoinColumn({ name: 'fk_document' })
  document?: DocumentOfficiel;

  // ─── En-tête Holding ────────────────────────────────────────────

  @Column({
    name: 'reference_holding',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  referenceHolding!: string | null;

  @Column({ name: 'date_emission_holding', type: 'date', nullable: true })
  dateEmissionHolding!: Date | null;

  @Column({
    name: 'signataire_holding',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  signataireHolding!: string | null;

  // ─── Objectifs quantitatifs (NUMERIC pg → string) ───────────────

  @Column({
    name: 'pnb_cible_mfcfa',
    type: 'numeric',
    precision: 15,
    scale: 2,
    nullable: true,
  })
  pnbCibleMfcfa!: string | null;

  @Column({
    name: 'rn_cible_mfcfa',
    type: 'numeric',
    precision: 15,
    scale: 2,
    nullable: true,
  })
  rnCibleMfcfa!: string | null;

  @Column({
    name: 'croissance_credits_pct',
    type: 'numeric',
    precision: 5,
    scale: 2,
    nullable: true,
  })
  croissanceCreditsPct!: string | null;

  @Column({
    name: 'croissance_depots_pct',
    type: 'numeric',
    precision: 5,
    scale: 2,
    nullable: true,
  })
  croissanceDepotsPct!: string | null;

  @Column({
    name: 'coefficient_exploitation_pct',
    type: 'numeric',
    precision: 5,
    scale: 2,
    nullable: true,
  })
  coefficientExploitationPct!: string | null;

  @Column({
    name: 'roe_cible_pct',
    type: 'numeric',
    precision: 5,
    scale: 2,
    nullable: true,
  })
  roeCiblePct!: string | null;

  // ─── Ratios prudentiels BCEAO ───────────────────────────────────

  @Column({
    name: 'ratio_solvabilite_min_pct',
    type: 'numeric',
    precision: 5,
    scale: 2,
    nullable: true,
  })
  ratioSolvabiliteMinPct!: string | null;

  @Column({
    name: 'ratio_liquidite_min_pct',
    type: 'numeric',
    precision: 5,
    scale: 2,
    nullable: true,
  })
  ratioLiquiditeMinPct!: string | null;

  @Column({
    name: 'ratio_division_risques_pct',
    type: 'numeric',
    precision: 5,
    scale: 2,
    nullable: true,
  })
  ratioDivisionRisquesPct!: string | null;

  // ─── Calendrier budgétaire (5 jalons) ───────────────────────────

  @Column({ name: 'date_debut_saisie', type: 'date', nullable: true })
  dateDebutSaisie!: Date | null;

  @Column({ name: 'date_limite_saisie_cr', type: 'date', nullable: true })
  dateLimiteSaisieCr!: Date | null;

  @Column({ name: 'date_validation_dga', type: 'date', nullable: true })
  dateValidationDga!: Date | null;

  @Column({ name: 'date_validation_dg', type: 'date', nullable: true })
  dateValidationDg!: Date | null;

  @Column({ name: 'date_publication_bceao', type: 'date', nullable: true })
  datePublicationBceao!: Date | null;

  // ─── Orientations stratégiques ──────────────────────────────────

  @Column({
    name: 'orientations_strategiques',
    type: 'text',
    nullable: true,
  })
  orientationsStrategiques!: string | null;

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
