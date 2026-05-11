import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { ColumnNumericTransformer } from '../../../common/transformers/column-numeric.transformer';
import { DimCentreResponsabilite } from '../../../referentiels/centre-responsabilite/entities/dim-centre-responsabilite.entity';
import { DimCompte } from '../../../referentiels/compte/entities/dim-compte.entity';
import { DimDevise } from '../../../referentiels/devise/entities/dim-devise.entity';
import { DimLigneMetier } from '../../../referentiels/ligne-metier/entities/dim-ligne-metier.entity';
import { DimProduit } from '../../../referentiels/produit/entities/dim-produit.entity';
import { DimScenario } from '../../../referentiels/scenario/entities/dim-scenario.entity';
import { DimSegment } from '../../../referentiels/segment/entities/dim-segment.entity';
import { DimStructure } from '../../../referentiels/structure/entities/dim-structure.entity';
import { DimTemps } from '../../../referentiels/temps/entities/dim-temps.entity';
import { DimVersion } from '../../../referentiels/version/entities/dim-version.entity';

export type ModeSaisieFaitBudget = 'MONTANT' | 'ENCOURS_TIE';

/**
 * `fait_budget` — table de faits centrale du module élaboration
 * budgétaire (cf. `docs/modele-donnees.md` §4.1).
 *
 * **Pas de SCD2** : un fait est immuable une fois écrit. Les
 * modifications passent par une mise à jour de mesures (3.2A) ou,
 * pour un changement structurant, par un DELETE + INSERT.
 *
 * **Écart §4.1** : `fk_ligne_metier`, `fk_produit`, `fk_segment` sont
 * **NOT NULL** (le doc les indiquait nullable avec sentinelle `id=0`).
 * Justification dans la migration `CreateFaitBudget1778100000000`.
 *
 * **Option B (cf. §6.3)** : les FK SCD2 (compte, structure, CR,
 * ligne_metier, produit, segment) doivent pointer vers la version
 * VALIDE À LA DATE MÉTIER (`fk_temps`), pas vers la version courante
 * au moment de l'INSERT. Validation applicative au Lot 3.2B.
 *
 * **Mode de saisie (Lot 3.1, migration `ExtendFaitBudget…`)** :
 *  - `MONTANT` : le préparateur saisit `montantDevise` directement
 *    (mode par défaut, encoursMoyen et tie restent NULL).
 *  - `ENCOURS_TIE` : le préparateur saisit `encoursMoyen` (encours
 *    moyen mensuel) et `tie` (taux annuel décimal, ex. 0.0850 pour
 *    8,50 %) ; le service `FaitBudgetService` recalcule
 *    `montantDevise = encoursMoyen × tie / 12`. Réservé aux comptes
 *    avec `est_porteur_interets = true` (validation applicative).
 *  Le CHECK `ck_fait_budget_coherence_mode` est la 2ᵉ ligne de défense
 *  côté DB (cf. `docs/modele-donnees.md` §4.1).
 */
@Entity({ name: 'fait_budget' })
@Check(
  'ck_fait_budget_coherence_mode',
  `(
    (
      "mode_saisie" = 'ENCOURS_TIE'
      AND "encours_moyen" IS NOT NULL
      AND "tie" IS NOT NULL
    )
    OR
    (
      "mode_saisie" = 'MONTANT'
      AND "encours_moyen" IS NULL
      AND "tie" IS NULL
    )
  )`,
)
@Check(
  'ck_fait_budget_tie_range',
  `"tie" IS NULL OR ("tie" >= 0 AND "tie" <= 1)`,
)
@Check(
  'ck_fait_budget_encours_positif',
  `"encours_moyen" IS NULL OR "encours_moyen" >= 0`,
)
@Check('ck_fait_budget_mode', `"mode_saisie" IN ('MONTANT','ENCOURS_TIE')`)
@Index('ix_fait_budget_temps', ['fkTemps'])
@Index('ix_fait_budget_compte', ['fkCompte'])
@Index('ix_fait_budget_structure', ['fkStructure'])
@Index('ix_fait_budget_centre', ['fkCentre'])
@Index('ix_fait_budget_ligne_metier', ['fkLigneMetier'])
@Index('ix_fait_budget_produit', ['fkProduit'])
@Index('ix_fait_budget_segment', ['fkSegment'])
@Index('ix_fait_budget_devise', ['fkDevise'])
@Index('ix_fait_budget_version', ['fkVersion'])
@Index('ix_fait_budget_scenario', ['fkScenario'])
@Index(
  'uq_fait_budget_grain',
  [
    'fkTemps',
    'fkCompte',
    'fkStructure',
    'fkCentre',
    'fkLigneMetier',
    'fkProduit',
    'fkSegment',
    'fkDevise',
    'fkVersion',
    'fkScenario',
  ],
  { unique: true },
)
@Index('ix_fait_budget_version_temps', ['fkVersion', 'fkTemps'])
@Index('ix_fait_budget_version_centre_temps', [
  'fkVersion',
  'fkCentre',
  'fkTemps',
])
@Index('ix_fait_budget_temps_compte', ['fkTemps', 'fkCompte'])
export class FaitBudget {
  @PrimaryGeneratedColumn('identity', { type: 'bigint' })
  id!: string;

  @Column({ name: 'fk_temps', type: 'bigint' })
  fkTemps!: string;

  @Column({ name: 'fk_compte', type: 'bigint' })
  fkCompte!: string;

  @Column({ name: 'fk_structure', type: 'bigint' })
  fkStructure!: string;

  @Column({ name: 'fk_centre', type: 'bigint' })
  fkCentre!: string;

  @Column({ name: 'fk_ligne_metier', type: 'bigint' })
  fkLigneMetier!: string;

  @Column({ name: 'fk_produit', type: 'bigint' })
  fkProduit!: string;

  @Column({ name: 'fk_segment', type: 'bigint' })
  fkSegment!: string;

  @Column({ name: 'fk_devise', type: 'bigint' })
  fkDevise!: string;

  @Column({ name: 'fk_version', type: 'bigint' })
  fkVersion!: string;

  @Column({ name: 'fk_scenario', type: 'bigint' })
  fkScenario!: string;

  @Column({
    name: 'montant_devise',
    type: 'numeric',
    precision: 20,
    scale: 4,
    transformer: ColumnNumericTransformer,
  })
  montantDevise!: number;

  @Column({
    name: 'montant_fcfa',
    type: 'numeric',
    precision: 20,
    scale: 4,
    transformer: ColumnNumericTransformer,
  })
  montantFcfa!: number;

  @Column({
    name: 'taux_change_applique',
    type: 'numeric',
    precision: 18,
    scale: 8,
    transformer: ColumnNumericTransformer,
  })
  tauxChangeApplique!: number;

  // ─── Mode de saisie (Lot 3.1, migration 1779200000000)

  @Column({
    name: 'mode_saisie',
    type: 'varchar',
    length: 20,
    default: 'MONTANT',
  })
  modeSaisie!: ModeSaisieFaitBudget;

  @Column({
    name: 'encours_moyen',
    type: 'numeric',
    precision: 20,
    scale: 4,
    nullable: true,
    transformer: ColumnNumericTransformer,
  })
  encoursMoyen!: number | null;

  @Column({
    name: 'tie',
    type: 'numeric',
    precision: 7,
    scale: 4,
    nullable: true,
    transformer: ColumnNumericTransformer,
  })
  tie!: number | null;

  @Column({ name: 'commentaire', type: 'text', nullable: true })
  commentaire!: string | null;

  @Column({
    name: 'date_creation',
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
  })
  dateCreation!: Date;

  @Column({ name: 'utilisateur_creation', type: 'varchar', length: 255 })
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

  // ─── Relations (chargées à la demande)

  @ManyToOne(() => DimTemps, { onDelete: 'RESTRICT', nullable: false })
  @JoinColumn({ name: 'fk_temps' })
  temps?: DimTemps;

  @ManyToOne(() => DimCompte, { onDelete: 'RESTRICT', nullable: false })
  @JoinColumn({ name: 'fk_compte' })
  compte?: DimCompte;

  @ManyToOne(() => DimStructure, { onDelete: 'RESTRICT', nullable: false })
  @JoinColumn({ name: 'fk_structure' })
  structure?: DimStructure;

  @ManyToOne(() => DimCentreResponsabilite, {
    onDelete: 'RESTRICT',
    nullable: false,
  })
  @JoinColumn({ name: 'fk_centre' })
  centre?: DimCentreResponsabilite;

  @ManyToOne(() => DimLigneMetier, { onDelete: 'RESTRICT', nullable: false })
  @JoinColumn({ name: 'fk_ligne_metier' })
  ligneMetier?: DimLigneMetier;

  @ManyToOne(() => DimProduit, { onDelete: 'RESTRICT', nullable: false })
  @JoinColumn({ name: 'fk_produit' })
  produit?: DimProduit;

  @ManyToOne(() => DimSegment, { onDelete: 'RESTRICT', nullable: false })
  @JoinColumn({ name: 'fk_segment' })
  segment?: DimSegment;

  @ManyToOne(() => DimDevise, { onDelete: 'RESTRICT', nullable: false })
  @JoinColumn({ name: 'fk_devise' })
  devise?: DimDevise;

  @ManyToOne(() => DimVersion, { onDelete: 'RESTRICT', nullable: false })
  @JoinColumn({ name: 'fk_version' })
  version?: DimVersion;

  @ManyToOne(() => DimScenario, { onDelete: 'RESTRICT', nullable: false })
  @JoinColumn({ name: 'fk_scenario' })
  scenario?: DimScenario;
}
