/**
 * `campagne_budgetaire` — Campagne annuelle de digitalisation du
 * processus budgétaire (Lot 8.1.A).
 *
 * Une campagne représente l'ensemble du cycle entre la lettre de cadrage
 * Holding et le PV de gel BCEAO d'une `dim_version`. Contient :
 *  - le Comité nominé pour visa des documents officiels (cf.
 *    [[CampagneComiteMembre]])
 *  - les documents officiels émis dans la campagne (cf.
 *    [[DocumentOfficiel]])
 *  - le calendrier global (dateLancement / dateFin)
 *
 * **PK UUID** (et non bigint) car les identifiants de campagne peuvent
 * apparaître dans des URLs/QR codes (documents signés) — UUID prévient
 * l'énumération.
 * **FK fkUserSignataireDefaut = BIGINT** pour matcher `User.id` (la
 * convention projet est bigint identity, cf. user.entity.ts).
 */
import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { User } from '../../users/entities/user.entity';
import { CampagneComiteMembre } from './campagne-comite-membre.entity';
import { DocumentOfficiel } from './document-officiel.entity';

export type StatutCampagne =
  | 'PARAMETRAGE'
  | 'EN_COURS'
  | 'TERMINEE'
  | 'ARCHIVEE';

export type ModeVisa = 'PARALLELE' | 'SEQUENTIEL';

@Entity({ name: 'campagne_budgetaire' })
@Index('idx_camp_exercice', ['exerciceFiscal'])
@Index('idx_camp_statut', ['statut'])
export class CampagneBudgetaire {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'code', type: 'varchar', length: 50, unique: true })
  code!: string;

  @Column({ name: 'exercice_fiscal', type: 'integer', unique: true })
  exerciceFiscal!: number;

  @Column({ name: 'libelle', type: 'varchar', length: 255 })
  libelle!: string;

  @Column({
    name: 'statut',
    type: 'varchar',
    length: 20,
    default: 'PARAMETRAGE',
  })
  statut!: StatutCampagne;

  @Column({
    name: 'mode_visa_defaut',
    type: 'varchar',
    length: 20,
    default: 'PARALLELE',
  })
  modeVisaDefaut!: ModeVisa;

  @Column({
    name: 'date_creation',
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
  })
  dateCreation!: Date;

  @Column({ name: 'date_lancement', type: 'timestamp', nullable: true })
  dateLancement!: Date | null;

  @Column({ name: 'date_fin', type: 'timestamp', nullable: true })
  dateFin!: Date | null;

  @Column({ name: 'fk_user_signataire_defaut', type: 'bigint' })
  fkUserSignataireDefaut!: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'fk_user_signataire_defaut' })
  signataireDefaut?: User;

  @Column({
    name: 'utilisateur_creation',
    type: 'varchar',
    length: 255,
  })
  utilisateurCreation!: string;

  @Column({
    name: 'utilisateur_modification',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  utilisateurModification!: string | null;

  @Column({ name: 'date_modification', type: 'timestamp', nullable: true })
  dateModification!: Date | null;

  // Relations inverses
  @OneToMany(() => CampagneComiteMembre, (m) => m.campagne)
  comiteMembres?: CampagneComiteMembre[];

  @OneToMany(() => DocumentOfficiel, (d) => d.campagne)
  documents?: DocumentOfficiel[];
}
