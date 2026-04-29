import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

import { Scd2Entity } from '../../../common/entities/scd2.entity';

export type CategorieSegment =
  | 'particulier'
  | 'professionnel'
  | 'pme'
  | 'grande_entreprise'
  | 'institutionnel'
  | 'secteur_public';

/**
 * `dim_segment` — Segmentation clientèle.
 * Cf. `docs/modele-donnees.md` §3.7.
 *
 * **SCD2 PLAT** : pas de hiérarchie au MVP (Option A retenue par
 * §3.7). Si une banque cliente requiert des sous-segments (ex.
 * `particulier_premium` / `particulier_mass_market`), ajouter
 * `fk_segment_parent` et `niveau` sera une extension non-cassante en
 * V2 — appliquer alors le pattern hiérarchique de `dim_compte`.
 */
@Entity({ name: 'dim_segment' })
@Index('ix_dim_segment_categorie', ['categorie'])
@Index('uq_dim_segment_business_date', ['codeSegment', 'dateDebutValidite'], {
  unique: true,
})
export class DimSegment extends Scd2Entity {
  @PrimaryGeneratedColumn('identity', { type: 'bigint' })
  id!: string;

  @Column({ name: 'code_segment', type: 'varchar', length: 50 })
  codeSegment!: string;

  @Column({ name: 'libelle', type: 'varchar', length: 200 })
  libelle!: string;

  @Column({ name: 'categorie', type: 'varchar', length: 30 })
  categorie!: CategorieSegment;
}
