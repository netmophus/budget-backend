import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Dataset figé (Chantier C-fix) : l'EcartsResponseDto entier au moment de la
 * génération + les libellés metadata, pour un export PDF fidèle des mois
 * après (document d'archive). `ecarts` reste opaque ici (typé
 * EcartsResponseDto au point d'usage) pour ne pas coupler l'entité au module
 * tableau-de-bord.
 */
export interface AnalyseIaDatasetSnapshot {
  ecarts: Record<string, unknown>;
  codeVersion: string;
  codeScenario: string;
}

/**
 * `analyse_ia` (Chantier C1) — historisation des analyses MIZNAS AI
 * réussies. Rend persistant ce qui était volatile (renvoyé au client puis
 * perdu). L'`audit_log` continue de tracer l'appel + les échecs ; cette
 * table stocke le CONTENU (markdown) pour consultation / export ultérieurs.
 */
@Entity({ name: 'analyse_ia' })
@Index('ix_analyse_ia_user_date', ['fkUser', 'dateGeneration'])
@Index('ix_analyse_ia_version_scenario', ['versionId', 'scenarioId'])
export class AnalyseIa {
  @PrimaryGeneratedColumn('identity', { type: 'bigint' })
  id!: string;

  /** Utilisateur demandeur. */
  @Column({ name: 'fk_user', type: 'bigint' })
  fkUser!: string;

  @Column({ name: 'date_generation', type: 'timestamp' })
  dateGeneration!: Date;

  // ─── Filtres appliqués ───────────────────────────────────────
  @Column({ name: 'version_id', type: 'bigint' })
  versionId!: string;

  @Column({ name: 'scenario_id', type: 'bigint' })
  scenarioId!: string;

  @Column({ name: 'mois_debut', type: 'varchar', length: 7 })
  moisDebut!: string;

  @Column({ name: 'mois_fin', type: 'varchar', length: 7 })
  moisFin!: string;

  /** CR sélectionnés (sous-ensemble) ou null = tous. */
  @Column({ name: 'crs_selectionnes', type: 'jsonb', nullable: true })
  crsSelectionnes!: string[] | null;

  // ─── Génération ──────────────────────────────────────────────
  @Column({ name: 'modele', type: 'varchar', length: 60 })
  modele!: string;

  /** Version du template de prompt (traçabilité, pas le texte complet). */
  @Column({ name: 'prompt_version', type: 'varchar', length: 40 })
  promptVersion!: string;

  @Column({ name: 'reponse_markdown', type: 'text' })
  reponseMarkdown!: string;

  /** Snapshot des KPI au moment T (liste rapide + comparaison C3). */
  @Column({ name: 'kpi_snapshot', type: 'jsonb', nullable: true })
  kpiSnapshot!: Record<string, unknown> | null;

  @Column({ name: 'tokens_in', type: 'int' })
  tokensIn!: number;

  @Column({ name: 'tokens_out', type: 'int' })
  tokensOut!: number;

  @Column({ name: 'duree_ms', type: 'int' })
  dureeMs!: number;

  /** Coût estimé en USD (tokens x tarif modèle). numeric -> string TypeORM. */
  @Column({ name: 'cout_estime', type: 'numeric', precision: 10, scale: 5 })
  coutEstime!: string;

  @Column({ name: 'dry_run', type: 'boolean' })
  dryRun!: boolean;

  /**
   * Dataset complet figé (Chantier C-fix). NULL pour les analyses C1
   * antérieures (fallback recalcul à l'export).
   */
  @Column({ name: 'dataset_snapshot', type: 'jsonb', nullable: true })
  datasetSnapshot!: AnalyseIaDatasetSnapshot | null;

  /** Toujours 'success' en C1 (les échecs restent dans audit_log). */
  @Column({ name: 'statut', type: 'varchar', length: 10, default: 'success' })
  statut!: string;

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
}
