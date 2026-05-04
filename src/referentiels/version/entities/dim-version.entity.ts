import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type TypeVersion =
  | 'budget_initial'
  | 'reforecast_1'
  | 'reforecast_2'
  | 'atterrissage';

export type StatutVersion = 'ouvert' | 'soumis' | 'valide' | 'gele';

/**
 * `dim_version` — Versions de budget. Cf. `docs/modele-donnees.md` §3.9.
 *
 * **PAS de SCD2** : une version est immuable une fois gelée. Le
 * workflow de transition (soumettre / valider / geler) sera ajouté
 * en Lot 3.3 ; au Lot 3.1, on n'expose que CRUD strict tant que
 * `statut = 'ouvert'`.
 */
@Entity({ name: 'dim_version' })
@Index('uq_dim_version_code', ['codeVersion'], { unique: true })
@Index('ix_dim_version_exercice_statut', ['exerciceFiscal', 'statut'])
@Index('ix_dim_version_type', ['typeVersion'])
export class DimVersion {
  @PrimaryGeneratedColumn('identity', { type: 'bigint' })
  id!: string;

  @Column({ name: 'code_version', type: 'varchar', length: 50 })
  codeVersion!: string;

  @Column({ name: 'libelle', type: 'varchar', length: 200 })
  libelle!: string;

  @Column({ name: 'type_version', type: 'varchar', length: 30 })
  typeVersion!: TypeVersion;

  @Column({ name: 'exercice_fiscal', type: 'int' })
  exerciceFiscal!: number;

  @Column({ name: 'statut', type: 'varchar', length: 20, default: 'ouvert' })
  statut!: StatutVersion;

  @Column({ name: 'date_gel', type: 'timestamp', nullable: true })
  dateGel!: Date | null;

  @Column({
    name: 'utilisateur_gel',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  utilisateurGel!: string | null;

  @Column({ name: 'commentaire', type: 'text', nullable: true })
  commentaire!: string | null;

  // ─── Workflow de validation (Lot 3.5) ───────────────────────────
  // 4 commentaires + traces (date + user) par transition. `date_gel`
  // et `utilisateur_gel` ci-dessus jouent le rôle de
  // date_publication / utilisateur_publication (alias historique).

  @Column({ name: 'commentaire_soumission', type: 'text', nullable: true })
  commentaireSoumission!: string | null;

  @Column({ name: 'commentaire_validation', type: 'text', nullable: true })
  commentaireValidation!: string | null;

  @Column({ name: 'commentaire_rejet', type: 'text', nullable: true })
  commentaireRejet!: string | null;

  @Column({ name: 'commentaire_publication', type: 'text', nullable: true })
  commentairePublication!: string | null;

  @Column({ name: 'date_soumission', type: 'timestamp', nullable: true })
  dateSoumission!: Date | null;

  @Column({
    name: 'utilisateur_soumission',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  utilisateurSoumission!: string | null;

  @Column({ name: 'date_validation', type: 'timestamp', nullable: true })
  dateValidation!: Date | null;

  @Column({
    name: 'utilisateur_validation',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  utilisateurValidation!: string | null;

  @Column({ name: 'date_rejet', type: 'timestamp', nullable: true })
  dateRejet!: Date | null;

  @Column({
    name: 'utilisateur_rejet',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  utilisateurRejet!: string | null;

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
}
