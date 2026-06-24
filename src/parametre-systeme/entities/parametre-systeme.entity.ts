import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type TypeParametre = 'STRING' | 'ENUM' | 'BOOLEAN' | 'NUMBER';

/**
 * `parametre_systeme` — table clé-valeur de paramétrage global de
 * l'application (feature toggles, modes opératoires…). Générique et
 * réutilisable (pas spécifique au réalisé).
 *
 * Chaque ligne est tracée à la modification (date / utilisateur) ; toute
 * écriture passe par `ParametreSystemeService.setValeur` qui dépose un
 * audit `MODIFIER_PARAMETRE_SYSTEME`.
 */
@Entity({ name: 'parametre_systeme' })
export class ParametreSysteme {
  @PrimaryGeneratedColumn('identity', { type: 'bigint' })
  id!: string;

  @Index('uq_parametre_systeme_cle', { unique: true })
  @Column({ name: 'cle', type: 'varchar', length: 100 })
  cle!: string;

  @Column({ name: 'valeur', type: 'text' })
  valeur!: string;

  @Column({ name: 'type', type: 'varchar', length: 20, default: 'STRING' })
  type!: TypeParametre;

  @Column({ name: 'description', type: 'text', nullable: true })
  description!: string | null;

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
