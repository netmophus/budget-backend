/**
 * `note_orientation_detail` — détail métier d'une Note d'orientation
 * interne BSIC (Lot 8.3.A).
 *
 * Relation 1-to-1 avec [[DocumentOfficiel]] : exactement 0 ou 1 ligne
 * par document de type D3_NOTE_ORIENTATION (contrainte applicative
 * côté `NoteOrientationService` + contrainte UNIQUE sur `fk_document`
 * côté DB).
 *
 * Affine le générique `document_officiel.contenu_html` (texte libre)
 * en données structurées requêtables : hypothèses macro, axes
 * stratégiques, parts de marché, etc.
 *
 * Différence avec [[LettreCadrageDetail]] (Lot 8.2.C) :
 *   D2 = lettre OFFICIELLE externe vers Directeurs de CR avec objectifs
 *        chiffrés (PNB, RN, ratios BCEAO)
 *   D3 = note INTERNE de Direction vers Comité de Direction avec
 *        analyse macroéconomique + axes stratégiques + description
 *        détaillée en HTML riche (TipTap)
 *
 * **Types NUMERIC** : pg renvoie en `string` pour préserver la
 * précision exacte (pattern projet aligné sur BIGINT user.id).
 *
 * **description_detaillee_html** : stocké en TEXT, généré par
 * l'éditeur TipTap côté frontend (HTML sécurisé par défaut, pas de
 * `<script>` ni d'attributs `on*`). Validation `@MaxLength(10000)`
 * côté DTO.
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

@Entity({ name: 'note_orientation_detail' })
@Index('idx_nod_fk_document', ['fkDocument'])
export class NoteOrientationDetail {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'fk_document', type: 'uuid', unique: true })
  fkDocument!: string;

  @OneToOne(() => DocumentOfficiel)
  @JoinColumn({ name: 'fk_document' })
  document?: DocumentOfficiel;

  // ─── En-tête note interne ───────────────────────────────────────

  @Column({
    name: 'numero_note',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  numeroNote!: string | null;

  @Column({ name: 'date_emission', type: 'date', nullable: true })
  dateEmission!: Date | null;

  @Column({
    name: 'emetteur_direction',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  emetteurDirection!: string | null;

  @Column({
    name: 'destinataire',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  destinataire!: string | null;

  // ─── Période d'application ──────────────────────────────────────

  @Column({ name: 'exercice_concerne', type: 'integer', nullable: true })
  exerciceConcerne!: number | null;

  @Column({ name: 'date_debut_application', type: 'date', nullable: true })
  dateDebutApplication!: Date | null;

  @Column({ name: 'date_fin_application', type: 'date', nullable: true })
  dateFinApplication!: Date | null;

  // ─── Hypothèses macroéconomiques (NUMERIC pg → string) ──────────

  @Column({
    name: 'taux_directeur_bceao_pct',
    type: 'numeric',
    precision: 5,
    scale: 2,
    nullable: true,
  })
  tauxDirecteurBceaoPct!: string | null;

  @Column({
    name: 'inflation_niger_pct',
    type: 'numeric',
    precision: 5,
    scale: 2,
    nullable: true,
  })
  inflationNigerPct!: string | null;

  @Column({
    name: 'croissance_pib_niger_pct',
    type: 'numeric',
    precision: 5,
    scale: 2,
    nullable: true,
  })
  croissancePibNigerPct!: string | null;

  @Column({
    name: 'taux_change_usd_fcfa',
    type: 'numeric',
    precision: 8,
    scale: 2,
    nullable: true,
  })
  tauxChangeUsdFcfa!: string | null;

  @Column({
    name: 'cours_petrole_usd',
    type: 'numeric',
    precision: 8,
    scale: 2,
    nullable: true,
  })
  coursPetroleUsd!: string | null;

  // ─── Positionnement marché BSIC ─────────────────────────────────

  @Column({
    name: 'part_marche_actuelle_pct',
    type: 'numeric',
    precision: 5,
    scale: 2,
    nullable: true,
  })
  partMarcheActuellePct!: string | null;

  @Column({
    name: 'part_marche_cible_pct',
    type: 'numeric',
    precision: 5,
    scale: 2,
    nullable: true,
  })
  partMarcheCiblePct!: string | null;

  @Column({
    name: 'principaux_concurrents',
    type: 'varchar',
    length: 500,
    nullable: true,
  })
  principauxConcurrents!: string | null;

  @Column({
    name: 'avantages_competitifs',
    type: 'varchar',
    length: 500,
    nullable: true,
  })
  avantagesCompetitifs!: string | null;

  // ─── Axes stratégiques prioritaires (4 axes) ────────────────────

  @Column({
    name: 'axe_digitalisation',
    type: 'varchar',
    length: 500,
    nullable: true,
  })
  axeDigitalisation!: string | null;

  @Column({
    name: 'axe_developpement_pme',
    type: 'varchar',
    length: 500,
    nullable: true,
  })
  axeDeveloppementPme!: string | null;

  @Column({
    name: 'axe_inclusion_financiere',
    type: 'varchar',
    length: 500,
    nullable: true,
  })
  axeInclusionFinanciere!: string | null;

  @Column({
    name: 'axe_autres_priorites',
    type: 'varchar',
    length: 500,
    nullable: true,
  })
  axeAutresPriorites!: string | null;

  // ─── Description détaillée (HTML riche TipTap) ──────────────────

  @Column({
    name: 'description_detaillee_html',
    type: 'text',
    nullable: true,
  })
  descriptionDetailleeHtml!: string | null;

  // ─── Recommandations ────────────────────────────────────────────

  @Column({ name: 'recommandations', type: 'text', nullable: true })
  recommandations!: string | null;

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
