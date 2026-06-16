import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Dimension temporelle — calendrier figé (PAS de SCD2 cf.
 * `docs/modele-donnees.md` §3.1). Pré-rempli par `temps-seed.ts`
 * sur 10 ans glissants.
 */
@Entity({ name: 'dim_temps' })
@Index('ix_dim_temps_annee_mois', ['annee', 'mois'])
@Index('ix_dim_temps_exercice_fiscal', ['exerciceFiscal'])
export class DimTemps {
  @PrimaryGeneratedColumn('identity', { type: 'bigint' })
  id!: string;

  @Index('uq_dim_temps_date', { unique: true })
  @Column({ name: 'date', type: 'date' })
  date!: string;

  @Column({ name: 'annee', type: 'int' })
  annee!: number;

  @Column({ name: 'trimestre', type: 'int' })
  trimestre!: number;

  @Column({ name: 'mois', type: 'int' })
  mois!: number;

  @Column({ name: 'jour', type: 'int' })
  jour!: number;

  @Column({ name: 'semaine_iso', type: 'int', nullable: true })
  semaineIso!: number | null;

  @Column({ name: 'jour_ouvre', type: 'boolean' })
  jourOuvre!: boolean;

  @Column({ name: 'est_fin_de_mois', type: 'boolean' })
  estFinDeMois!: boolean;

  @Column({ name: 'est_fin_de_trimestre', type: 'boolean' })
  estFinDeTrimestre!: boolean;

  @Column({ name: 'est_fin_d_annee', type: 'boolean' })
  estFinDAnnee!: boolean;

  @Column({ name: 'exercice_fiscal', type: 'int' })
  exerciceFiscal!: number;

  @Column({ name: 'libelle_mois', type: 'varchar', length: 20 })
  libelleMois!: string;

  // Lot 8.7.A — libellé éditable d'un jour férié (ex. Aïd el-Fitr 2027,
  // Tabaski, décret présidentiel). Nullable, renseigné à la main par
  // l'ADMIN via PATCH. Les fériés mobiles ne sont pas calculés (cf.
  // temps-seed.ts qui ne pose que les 4 fériés fixes UEMOA).
  @Column({
    name: 'libelle_jour',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  libelleJour!: string | null;
}
