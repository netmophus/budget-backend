/**
 * `document_officiel` — Document du workflow signature (Lot 8.1.A).
 *
 * Table pivot. Chaque document = 1 lettre/note officielle dans le
 * cadre d'une [[CampagneBudgetaire]]. Cycle de vie :
 *   BROUILLON → SOUMIS_VISA → VISE → SIGNE → ARCHIVE
 *
 * Le `contenu_html` est le rendu canonique, `contenu_json` un AST optionnel
 * pour l'éditeur frontend (TipTap ou équivalent). `reference_externe`
 * permet de lier à un courrier physique reçu (ex : "REF-BSIC-HOLDING-2026-001").
 *
 * Au moment de la signature (transition VISE → SIGNE), `hash_contenu_signe`
 * est rempli (SHA-256 du contenu_html canonique + visas figés). La
 * contrainte CHECK `ck_doc_hash_si_signe` garantit que le hash existe
 * dès que le statut atteint SIGNE/ARCHIVE.
 *
 * `fk_version_budget` lie le document à la version budget qu'il accompagne
 * (typiquement renseigné pour les "Lettre DG", "PV de gel", etc.).
 */
import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { DimVersion } from '../../referentiels/version/entities/dim-version.entity';
import { User } from '../../users/entities/user.entity';
import { CampagneBudgetaire } from './campagne-budgetaire.entity';
import { DocumentSignature } from './document-signature.entity';
import { DocumentVisa } from './document-visa.entity';

export type StatutDocument =
  | 'BROUILLON'
  | 'SOUMIS_VISA'
  | 'VISE'
  | 'SIGNE'
  | 'ARCHIVE';

@Entity({ name: 'document_officiel' })
@Index('idx_doc_type', ['typeDocument'])
@Index('idx_doc_statut', ['statut'])
@Index('idx_doc_campagne', ['fkCampagne'])
@Index('idx_doc_emetteur', ['fkUserEmetteur'])
@Index('idx_doc_signataire', ['fkUserSignataire'])
@Index('idx_doc_version_budget', ['fkVersionBudget'])
export class DocumentOfficiel {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({
    name: 'code_document',
    type: 'varchar',
    length: 50,
    unique: true,
  })
  codeDocument!: string;

  @Column({ name: 'type_document', type: 'varchar', length: 50 })
  typeDocument!: string;

  @Column({ name: 'fk_campagne', type: 'uuid', nullable: true })
  fkCampagne!: string | null;

  @ManyToOne(() => CampagneBudgetaire, (c) => c.documents)
  @JoinColumn({ name: 'fk_campagne' })
  campagne?: CampagneBudgetaire;

  @Column({ name: 'titre', type: 'varchar', length: 255 })
  titre!: string;

  @Column({ name: 'contenu_html', type: 'text' })
  contenuHtml!: string;

  @Column({ name: 'contenu_json', type: 'jsonb', nullable: true })
  contenuJson!: object | null;

  @Column({
    name: 'reference_externe',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  referenceExterne!: string | null;

  @Column({
    name: 'statut',
    type: 'varchar',
    length: 20,
    default: 'BROUILLON',
  })
  statut!: StatutDocument;

  @Column({ name: 'fk_user_emetteur', type: 'bigint' })
  fkUserEmetteur!: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'fk_user_emetteur' })
  emetteur?: User;

  @Column({ name: 'fk_user_signataire', type: 'bigint' })
  fkUserSignataire!: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'fk_user_signataire' })
  signataire?: User;

  @Column({ name: 'fk_version_budget', type: 'bigint', nullable: true })
  fkVersionBudget!: string | null;

  @ManyToOne(() => DimVersion)
  @JoinColumn({ name: 'fk_version_budget' })
  versionBudget?: DimVersion;

  @Column({
    name: 'date_creation',
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
  })
  dateCreation!: Date;

  @Column({ name: 'date_modification', type: 'timestamp', nullable: true })
  dateModification!: Date | null;

  @Column({ name: 'date_soumission_visa', type: 'timestamp', nullable: true })
  dateSoumissionVisa!: Date | null;

  @Column({ name: 'date_visa_complet', type: 'timestamp', nullable: true })
  dateVisaComplet!: Date | null;

  @Column({ name: 'date_signature', type: 'timestamp', nullable: true })
  dateSignature!: Date | null;

  @Column({ name: 'date_archivage', type: 'timestamp', nullable: true })
  dateArchivage!: Date | null;

  @Column({
    name: 'hash_contenu_signe',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  hashContenuSigne!: string | null;

  @Column({
    name: 'fichier_joint_path',
    type: 'varchar',
    length: 500,
    nullable: true,
  })
  fichierJointPath!: string | null;

  @Column({
    name: 'fichier_joint_nom',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  fichierJointNom!: string | null;

  /**
   * Contenu binaire du PDF stocké EN BASE (cf. migration ...630). Le PDF
   * n'est plus sur disque (FS éphémère sur PaaS). `select: false` : le
   * blob (≤ 10 Mo) N'EST PAS chargé sur les `findOne`/`find` courants —
   * uniquement via une requête ciblée au moment du téléchargement. Ça
   * évite de tirer des mégaoctets sur chaque lecture de document et
   * garantit qu'il n'est jamais sérialisé dans les réponses JSON.
   */
  @Column({
    name: 'fichier_contenu',
    type: 'bytea',
    nullable: true,
    select: false,
  })
  fichierContenu!: Buffer | null;

  @Column({ name: 'fichier_taille', type: 'integer', nullable: true })
  fichierTaille!: number | null;

  @Column({
    name: 'fichier_mime',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  fichierMime!: string | null;

  @Column({
    name: 'utilisateur_creation',
    type: 'varchar',
    length: 255,
  })
  utilisateurCreation!: string;

  @Column({
    name: 'utilisateur_modification',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  utilisateurModification!: string | null;

  // Relations inverses
  @OneToMany(() => DocumentVisa, (v) => v.document)
  visas?: DocumentVisa[];

  @OneToOne(() => DocumentSignature, (s) => s.document)
  signature?: DocumentSignature;
}
