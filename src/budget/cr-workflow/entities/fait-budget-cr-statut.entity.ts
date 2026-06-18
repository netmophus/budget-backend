import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Statut de cycle de saisie/validation d'un CR pour une version donnée
 * (Lot workflow par CR). Grain : 1 ligne par (version × CR).
 *
 * Cycle : EN_SAISIE → SOUMIS → VALIDE
 *   - soumettre (saisisseur) : EN_SAISIE → SOUMIS
 *   - valider   (validateur) : SOUMIS → VALIDE
 *   - rejeter   (validateur) : SOUMIS → EN_SAISIE (motif obligatoire)
 *   - rouvrir   (validateur) : VALIDE → EN_SAISIE (motif obligatoire)
 *
 * `fk_saisisseur` / `fk_validateur` sont des snapshots (qui a soumis /
 * validé) ; `fk_user_modif` trace le dernier acteur.
 */
export type StatutCrSaisie = 'EN_SAISIE' | 'SOUMIS' | 'VALIDE';

@Entity({ name: 'fait_budget_cr_statut' })
@Index('uq_fbcs_version_cr', ['fkVersion', 'fkCr'], { unique: true })
@Index('ix_fbcs_version_statut', ['fkVersion', 'statut'])
export class FaitBudgetCrStatut {
  @PrimaryGeneratedColumn('identity', { type: 'bigint' })
  id!: string;

  @Column({ name: 'fk_version', type: 'bigint' })
  fkVersion!: string;

  @Column({ name: 'fk_cr', type: 'bigint' })
  fkCr!: string;

  @Column({
    name: 'statut',
    type: 'varchar',
    length: 20,
    default: 'EN_SAISIE',
  })
  statut!: StatutCrSaisie;

  @Column({ name: 'date_soumission', type: 'timestamp', nullable: true })
  dateSoumission!: Date | null;

  @Column({ name: 'date_validation', type: 'timestamp', nullable: true })
  dateValidation!: Date | null;

  @Column({ name: 'date_reouverture', type: 'timestamp', nullable: true })
  dateReouverture!: Date | null;

  @Column({ name: 'fk_saisisseur', type: 'bigint', nullable: true })
  fkSaisisseur!: string | null;

  @Column({ name: 'fk_validateur', type: 'bigint', nullable: true })
  fkValidateur!: string | null;

  @Column({ name: 'motif_rejet', type: 'text', nullable: true })
  motifRejet!: string | null;

  @Column({ name: 'motif_reouverture', type: 'text', nullable: true })
  motifReouverture!: string | null;

  @Column({
    name: 'date_creation',
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
  })
  dateCreation!: Date;

  @Column({ name: 'date_modification', type: 'timestamp', nullable: true })
  dateModification!: Date | null;

  @Column({ name: 'fk_user_modif', type: 'bigint', nullable: true })
  fkUserModif!: string | null;
}
