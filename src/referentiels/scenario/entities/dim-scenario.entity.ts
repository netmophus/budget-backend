import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type TypeScenario =
  | 'central'
  | 'optimiste'
  | 'pessimiste'
  | 'alternatif';
export type StatutScenario = 'actif' | 'archive';

/**
 * `dim_scenario` — Scénarios appliqués à une version de budget.
 * Cf. `docs/modele-donnees.md` §3.10.
 *
 * **Pas de SCD2**. Pas de DELETE physique : un scénario référencé
 * par `fait_budget` ne doit jamais disparaître. Seul un archivage
 * (statut='actif' → 'archive') est exposé pour retirer un scénario
 * du choix utilisateur tout en préservant les faits historisés.
 */
@Entity({ name: 'dim_scenario' })
@Index('uq_dim_scenario_code', ['codeScenario'], { unique: true })
@Index('ix_dim_scenario_statut', ['statut'])
export class DimScenario {
  @PrimaryGeneratedColumn('identity', { type: 'bigint' })
  id!: string;

  @Column({ name: 'code_scenario', type: 'varchar', length: 50 })
  codeScenario!: string;

  @Column({ name: 'libelle', type: 'varchar', length: 200 })
  libelle!: string;

  @Column({ name: 'type_scenario', type: 'varchar', length: 20 })
  typeScenario!: TypeScenario;

  @Column({ name: 'statut', type: 'varchar', length: 20, default: 'actif' })
  statut!: StatutScenario;

  @Column({ name: 'commentaire', type: 'text', nullable: true })
  commentaire!: string | null;

  /**
   * Exercice fiscal de rattachement (ajouté Lot 3.2). Optionnel : un
   * scénario peut rester macro/transversal (NULL). Les scénarios
   * créés automatiquement par le hook Q9 portent l'exercice de la
   * version qui les a déclenchés.
   */
  @Column({ name: 'exercice_fiscal', type: 'int', nullable: true })
  exerciceFiscal!: number | null;

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
