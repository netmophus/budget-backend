import { Check, Column, Entity, OneToMany, PrimaryColumn } from 'typeorm';

import { ConfigurationBanqueMembreComite } from './configuration-banque-membre-comite.entity';

/**
 * `configuration_banque` — configuration institutionnelle de la banque
 * cliente (Lot B1). Table MONO-LIGNE : la contrainte CHECK `id = 1`
 * garantit qu'il ne peut exister qu'une seule configuration.
 *
 * Externalise tout ce qui était hardcodé « BSIC NIGER » dans les rendus
 * (PDF, Excel, emails, front) pour rendre MIZNAS multi-banques. Les
 * champs de contexte (marché, concurrents, positionnement) alimenteront
 * le prompt IA (Chantier A).
 *
 * Écriture tracée par un audit `CONFIGURATION_BANQUE_MODIFIEE` dans la
 * même transaction (cohérence réglementaire — cf. ParametreSystemeService).
 */
@Entity({ name: 'configuration_banque' })
@Check('chk_configuration_banque_singleton', '"id" = 1')
export class ConfigurationBanque {
  /** Toujours 1 (table mono-ligne verrouillée par CHECK). */
  @PrimaryColumn({ type: 'bigint' })
  id!: string;

  // ─── Identité ────────────────────────────────────────────────
  @Column({ name: 'nom', type: 'varchar', length: 200 })
  nom!: string;

  @Column({ name: 'sigle', type: 'varchar', length: 50 })
  sigle!: string;

  @Column({ name: 'nom_commercial_complet', type: 'text', nullable: true })
  nomCommercialComplet!: string | null;

  @Column({
    name: 'forme_juridique',
    type: 'varchar',
    length: 50,
    nullable: true,
  })
  formeJuridique!: string | null;

  @Column({ name: 'groupe', type: 'varchar', length: 200, nullable: true })
  groupe!: string | null;

  // ─── Adresse ─────────────────────────────────────────────────
  @Column({ name: 'siege_social', type: 'text', nullable: true })
  siegeSocial!: string | null;

  @Column({ name: 'ville_siege', type: 'varchar', length: 100, nullable: true })
  villeSiege!: string | null;

  @Column({ name: 'pays', type: 'varchar', length: 100, nullable: true })
  pays!: string | null;

  @Column({ name: 'telephone', type: 'varchar', length: 50, nullable: true })
  telephone!: string | null;

  @Column({
    name: 'email_contact',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  emailContact!: string | null;

  // ─── Réglementaire ───────────────────────────────────────────
  @Column({
    name: 'ref_reglementaire_bceao',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  refReglementaireBceao!: string | null;

  @Column({
    name: 'exercice_fiscal_libelle',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  exerciceFiscalLibelle!: string | null;

  // ─── Charte graphique ────────────────────────────────────────
  @Column({ name: 'couleur_primaire', type: 'varchar', length: 7 })
  couleurPrimaire!: string;

  @Column({ name: 'couleur_primaire_dark', type: 'varchar', length: 7 })
  couleurPrimaireDark!: string;

  @Column({ name: 'couleur_secondaire', type: 'varchar', length: 7 })
  couleurSecondaire!: string;

  @Column({ name: 'logo_ref', type: 'varchar', length: 500, nullable: true })
  logoRef!: string | null;

  // ─── Contexte IA (Chantier A) ────────────────────────────────
  @Column({ name: 'contexte_marche', type: 'text', nullable: true })
  contexteMarche!: string | null;

  @Column({ name: 'concurrents', type: 'varchar', length: 500, nullable: true })
  concurrents!: string | null;

  @Column({ name: 'positionnement', type: 'text', nullable: true })
  positionnement!: string | null;

  // ─── Audit ───────────────────────────────────────────────────
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

  @OneToMany(
    () => ConfigurationBanqueMembreComite,
    (membre) => membre.configuration,
  )
  membres?: ConfigurationBanqueMembreComite[];
}
