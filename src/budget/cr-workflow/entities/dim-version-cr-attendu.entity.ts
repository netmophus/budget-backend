import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Snapshot FIGÉ des CR « attendus » pour une version (Lot workflow par
 * CR). Définit le dénominateur du compteur « X/Y CR validés » et la
 * condition de bascule automatique OUVERT → PRE_VALIDE.
 *
 * Peuplé au lancement de la version = union des périmètres effectifs
 * des utilisateurs actifs portant le rôle SAISISSEUR (cf.
 * PerimetreService.getPerimetreEffectif), figé à l'insert pour qu'un
 * changement ultérieur de périmètre ne casse pas la cohérence du cycle.
 *
 * `actif = false` = CR retiré manuellement du snapshot par le
 * Coordinateur (action exceptionnelle tracée, `motif_retrait`).
 */
export type SourceCrAttendu = 'AUTO' | 'MANUEL';

@Entity({ name: 'dim_version_cr_attendu' })
@Index('uq_dvca_version_cr', ['fkVersion', 'fkCr'], { unique: true })
@Index('ix_dvca_version_actif', ['fkVersion', 'actif'])
export class DimVersionCrAttendu {
  @PrimaryGeneratedColumn('identity', { type: 'bigint' })
  id!: string;

  @Column({ name: 'fk_version', type: 'bigint' })
  fkVersion!: string;

  @Column({ name: 'fk_cr', type: 'bigint' })
  fkCr!: string;

  @Column({ name: 'source', type: 'varchar', length: 10, default: 'AUTO' })
  source!: SourceCrAttendu;

  @Column({ name: 'actif', type: 'boolean', default: true })
  actif!: boolean;

  @Column({ name: 'motif_retrait', type: 'text', nullable: true })
  motifRetrait!: string | null;

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
