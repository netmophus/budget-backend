import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { DimDevise } from '../../devise/entities/dim-devise.entity';
import { DimTemps } from '../../temps/entities/dim-temps.entity';

export type TypeTaux = 'cloture' | 'moyen_mensuel' | 'fixe_budgetaire';

/**
 * `ref_taux_change` — Historique des taux de change BCEAO.
 * Cf. `docs/modele-donnees.md` §5.1.
 *
 * **Invariant** : un seul taux par triplet (devise, date, type) —
 * garanti par `uq_ref_taux_change_triplet`.
 *
 * **Note de design** : `ref_taux_change` n'est PAS référencé par
 * les faits via FK ; le taux applicable est COPIÉ dans
 * `fait_budget.taux_change_applique` au moment de la saisie. Cela
 * permet de modifier ou supprimer un taux historique sans casser
 * les faits déjà écrits (cf. `modele-donnees.md` §4.1).
 */
@Entity({ name: 'ref_taux_change' })
@Index('uq_ref_taux_change_triplet', ['fkDevise', 'fkTemps', 'typeTaux'], {
  unique: true,
})
@Index('ix_ref_taux_change_devise', ['fkDevise'])
@Index('ix_ref_taux_change_temps', ['fkTemps'])
@Index('ix_ref_taux_change_devise_type', ['fkDevise', 'typeTaux'])
export class RefTauxChange {
  @PrimaryGeneratedColumn('identity', { type: 'bigint' })
  id!: string;

  @Column({ name: 'fk_devise', type: 'bigint' })
  fkDevise!: string;

  @Column({ name: 'fk_temps', type: 'bigint' })
  fkTemps!: string;

  @Column({ name: 'taux_vers_pivot', type: 'numeric', precision: 18, scale: 8 })
  tauxVersPivot!: string;

  @Column({ name: 'source', type: 'varchar', length: 50, default: 'BCEAO' })
  source!: string;

  @Column({ name: 'type_taux', type: 'varchar', length: 30 })
  typeTaux!: TypeTaux;

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

  @ManyToOne(() => DimDevise, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'fk_devise' })
  devise?: DimDevise;

  @ManyToOne(() => DimTemps, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'fk_temps' })
  temps?: DimTemps;
}
