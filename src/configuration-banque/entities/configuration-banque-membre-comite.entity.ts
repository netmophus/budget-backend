import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { ConfigurationBanque } from './configuration-banque.entity';

export type FonctionComite = 'PRESIDENT' | 'MEMBRE' | 'SECRETAIRE' | 'DG';

export const FONCTIONS_COMITE: readonly FonctionComite[] = [
  'PRESIDENT',
  'MEMBRE',
  'SECRETAIRE',
  'DG',
];

/**
 * `configuration_banque_membre_comite` — membres du Comité Budgétaire
 * (Lot B1). Alimente la page « Approbations » des PDF officiels (le
 * `MEMBRES_COMITE` hardcodé du template est débranché en Lot B2).
 *
 * Désactivation logique (`est_actif`) plutôt que suppression physique
 * pour conserver la traçabilité.
 */
@Entity({ name: 'configuration_banque_membre_comite' })
@Index('ix_config_banque_membre_config', ['fkConfigurationBanque'])
export class ConfigurationBanqueMembreComite {
  @PrimaryGeneratedColumn('identity', { type: 'bigint' })
  id!: string;

  @Column({ name: 'fk_configuration_banque', type: 'bigint' })
  fkConfigurationBanque!: string;

  @Column({ name: 'nom_prenom', type: 'varchar', length: 200 })
  nomPrenom!: string;

  @Column({ name: 'titre', type: 'varchar', length: 20, nullable: true })
  titre!: string | null;

  @Column({ name: 'fonction', type: 'varchar', length: 20 })
  fonction!: FonctionComite;

  @Column({ name: 'ordre_affichage', type: 'int', default: 0 })
  ordreAffichage!: number;

  @Column({ name: 'est_actif', type: 'boolean', default: true })
  estActif!: boolean;

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

  @ManyToOne(() => ConfigurationBanque, (config) => config.membres, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'fk_configuration_banque' })
  configuration?: ConfigurationBanque;
}
