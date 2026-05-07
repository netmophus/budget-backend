import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { ColumnNumericTransformer } from '../../common/transformers/column-numeric.transformer';
import { DimCentreResponsabilite } from '../../referentiels/centre-responsabilite/entities/dim-centre-responsabilite.entity';
import { DimCompte } from '../../referentiels/compte/entities/dim-compte.entity';
import { DimDevise } from '../../referentiels/devise/entities/dim-devise.entity';
import { DimLigneMetier } from '../../referentiels/ligne-metier/entities/dim-ligne-metier.entity';
import { DimTemps } from '../../referentiels/temps/entities/dim-temps.entity';
import { User } from '../../users/entities/user.entity';

export type StatutFaitRealise = 'IMPORTE' | 'VALIDE';
export type SourceFaitRealise = 'IMPORT' | 'SAISIE';
export type ModeFaitRealise = 'MNT' | 'VOL' | 'UNIT';

/**
 * `fait_realise` — table de faits dédiée au réalisé budgétaire
 * (Lot 5.1, mensuel). Décisions produit Q3 (table dédiée — pas
 * de réutilisation de fait_budget) et Q4 (workflow simple à 2
 * statuts : IMPORTE → VALIDE).
 *
 * Contrainte d'unicité : 1 ligne unique par combinaison de
 * dimensions (CR × compte × ligne_metier × temps × devise).
 *
 * Workflow :
 *  - `statut='IMPORTE'` (initial après création/import) — modifiable
 *    et supprimable
 *  - `statut='VALIDE'` (après validation par REALISE.VALIDER) —
 *    immuable. `valide_le` et `fk_valide_par` doivent être renseignés.
 */
@Entity({ name: 'fait_realise' })
@Index('idx_fait_realise_cr_temps', ['fkCentreResponsabilite', 'fkTemps'])
@Index('idx_fait_realise_compte_temps', ['fkCompte', 'fkTemps'])
@Index('idx_fait_realise_statut', ['statut'])
@Check('chk_fait_realise_statut', `"statut" IN ('IMPORTE','VALIDE')`)
@Check('chk_fait_realise_source', `"source" IN ('IMPORT','SAISIE')`)
@Check('chk_fait_realise_mode', `"mode" IN ('MNT','VOL','UNIT')`)
@Check(
  'chk_fait_realise_valide_coherence',
  `(
    ("statut" = 'VALIDE'
      AND "valide_le" IS NOT NULL
      AND "fk_valide_par" IS NOT NULL)
    OR
    ("statut" = 'IMPORTE'
      AND "valide_le" IS NULL
      AND "fk_valide_par" IS NULL)
  )`,
)
export class FaitRealise {
  @PrimaryGeneratedColumn('identity', { type: 'bigint' })
  id!: string;

  @Column({ name: 'fk_centre_responsabilite', type: 'bigint' })
  fkCentreResponsabilite!: string;

  @Column({ name: 'fk_compte', type: 'bigint' })
  fkCompte!: string;

  @Column({ name: 'fk_ligne_metier', type: 'bigint' })
  fkLigneMetier!: string;

  @Column({ name: 'fk_temps', type: 'bigint' })
  fkTemps!: string;

  @Column({ name: 'fk_devise', type: 'bigint' })
  fkDevise!: string;

  @Column({
    name: 'montant',
    type: 'numeric',
    precision: 20,
    scale: 2,
    transformer: ColumnNumericTransformer,
  })
  montant!: number;

  @Column({
    name: 'taux_change_applique',
    type: 'numeric',
    precision: 10,
    scale: 6,
    default: 1,
    transformer: ColumnNumericTransformer,
  })
  tauxChangeApplique!: number;

  @Column({ name: 'mode', type: 'varchar', length: 10, default: 'MNT' })
  mode!: ModeFaitRealise;

  @Column({ name: 'statut', type: 'varchar', length: 20, default: 'IMPORTE' })
  statut!: StatutFaitRealise;

  @Column({ name: 'source', type: 'varchar', length: 20 })
  source!: SourceFaitRealise;

  @Column({ name: 'commentaire', type: 'text', nullable: true })
  commentaire!: string | null;

  @Column({ name: 'valide_le', type: 'timestamp', nullable: true })
  valideLe!: Date | null;

  @Column({ name: 'fk_valide_par', type: 'bigint', nullable: true })
  fkValidePar!: string | null;

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

  @ManyToOne(() => DimCentreResponsabilite, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'fk_centre_responsabilite' })
  centreResponsabilite!: DimCentreResponsabilite;

  @ManyToOne(() => DimCompte, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'fk_compte' })
  compte!: DimCompte;

  @ManyToOne(() => DimLigneMetier, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'fk_ligne_metier' })
  ligneMetier!: DimLigneMetier;

  @ManyToOne(() => DimTemps, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'fk_temps' })
  temps!: DimTemps;

  @ManyToOne(() => DimDevise, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'fk_devise' })
  devise!: DimDevise;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'fk_valide_par' })
  validePar!: User | null;
}
