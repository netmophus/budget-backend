/**
 * `lettre_officialisation_detail` — détail métier d'une Lettre
 * d'officialisation BSIC (Lot 8.3.E).
 *
 * Relation 1-to-1 avec [[DocumentOfficiel]] : exactement 0 ou 1 ligne
 * par document de type D12_LETTRE_OFFICIALISATION (contrainte applicative
 * côté `LettreOfficialisationService` + contrainte UNIQUE sur
 * `fk_document` côté DB).
 *
 * 6e et dernier type métier riche de la phase 8.3 après D2 (Lot 8.2.C),
 * D3 (Lot 8.3.A), D5 (Lot 8.3.B), D1 (Lot 8.3.C) et D11 (Lot 8.3.D).
 * Exclusion mutuelle stricte entre les 6 : un document a au plus UN
 * détail métier riche non-null.
 *
 * **Position dans le cycle BSIC** : la Lettre d'officialisation est
 * émise APRÈS la signature du PV CA (D11). Elle notifie l'approbation
 * du budget aux parties prenantes et marque l'entrée en vigueur
 * officielle du budget approuvé.
 *
 * Cycle complet : **D1 (Note préparatoire DG) → D3 (Orientation Comité)
 * → D2 (Cadrage Directeurs CR) → D5 (Mobilisation tous Directeurs) →
 * D11 (PV d'approbation CA) → D12 (Lettre d'officialisation)**.
 *
 * **Particularités D12** :
 *  - 1 colonne TipTap (corpsHtml) — pas 2 comme D11
 *  - 1 BOOLEAN (cachetAppose) — workflow cachet physique post-signature
 *  - `referencePvCa` = texte libre VARCHAR(100), AUCUN FK vers
 *    pv_approbation_detail (Option A actée — la lettre peut référencer
 *    un PV externe filiale, un PV non encore créé en base, ou plusieurs
 *    PV via texte libre)
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

@Entity({ name: 'lettre_officialisation_detail' })
@Index('idx_lod_fk_document', ['fkDocument'])
export class LettreOfficialisationDetail {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'fk_document', type: 'uuid', unique: true })
  fkDocument!: string;

  @OneToOne(() => DocumentOfficiel)
  @JoinColumn({ name: 'fk_document' })
  document?: DocumentOfficiel;

  // ─── Identification de la lettre ────────────────────────────────

  @Column({
    name: 'numero_lettre',
    type: 'varchar',
    length: 50,
    nullable: true,
  })
  numeroLettre!: string | null;

  @Column({ name: 'date_emission', type: 'date', nullable: true })
  dateEmission!: Date | null;

  @Column({
    name: 'objet',
    type: 'varchar',
    length: 500,
    nullable: true,
  })
  objet!: string | null;

  // ─── Référence PV CA (texte libre — Option A) ───────────────────

  @Column({
    name: 'reference_pv_ca',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  referencePvCa!: string | null;

  // ─── Destinataires ──────────────────────────────────────────────

  @Column({
    name: 'destinataires_principaux',
    type: 'varchar',
    length: 2000,
    nullable: true,
  })
  destinatairesPrincipaux!: string | null;

  @Column({
    name: 'destinataires_copies',
    type: 'varchar',
    length: 2000,
    nullable: true,
  })
  destinatairesCopies!: string | null;

  @Column({
    name: 'pieces_jointes',
    type: 'varchar',
    length: 2000,
    nullable: true,
  })
  piecesJointes!: string | null;

  // ─── Corps de la lettre (HTML riche TipTap) ─────────────────────

  @Column({ name: 'corps_html', type: 'text', nullable: true })
  corpsHtml!: string | null;

  // ─── Signature & officialisation ────────────────────────────────

  @Column({
    name: 'signataire',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  signataire!: string | null;

  @Column({ name: 'date_entree_vigueur', type: 'date', nullable: true })
  dateEntreeVigueur!: Date | null;

  @Column({ name: 'cachet_appose', type: 'boolean', nullable: true })
  cachetAppose!: boolean | null;

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
