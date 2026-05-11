import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import type { SensCompte } from '../entities/dim-compte.entity';

/** Cf. `scd2-pattern.md` §7. */
export type ModeMajCompte =
  | 'nouvelle_version'
  | 'ecrasement_intra_jour'
  | 'in_place_est_actif';

/** Vue compacte du parent — embarquée dans la réponse compte. */
export class ParentCompteDto {
  @ApiProperty({ example: '12' })
  id!: string;

  @ApiProperty({ example: '601' })
  codeCompte!: string;

  @ApiProperty({ example: 'Achats consommables' })
  libelle!: string;
}

export class CompteResponseDto {
  @ApiProperty({ example: '42' })
  id!: string;

  @ApiProperty({ example: '601100' })
  codeCompte!: string;

  @ApiProperty({ example: 'Fournitures de bureau' })
  libelle!: string;

  @ApiProperty({
    example: '6',
    description: 'Classe PCB UMOA stockée en varchar (Lot 2.5-bis-B).',
  })
  classe!: string;

  @ApiPropertyOptional({ example: '60', nullable: true })
  sousClasse!: string | null;

  @ApiPropertyOptional({ example: '12', nullable: true })
  fkCompteParent!: string | null;

  @ApiPropertyOptional({ type: ParentCompteDto })
  parentCourant?: ParentCompteDto;

  @ApiProperty({ example: 4 })
  niveau!: number;

  @ApiPropertyOptional({ enum: ['D', 'C', 'M'], nullable: true })
  sens!: SensCompte | null;

  @ApiPropertyOptional({ example: 'ACHATS_DIVERS', nullable: true })
  codePosteBudgetaire!: string | null;

  @ApiProperty({ example: false })
  estCompteCollectif!: boolean;

  @ApiProperty({ example: false })
  estPorteurInterets!: boolean;

  @ApiProperty({ example: '2026-04-15', format: 'date' })
  dateDebutValidite!: string;

  @ApiPropertyOptional({ example: null, nullable: true, format: 'date' })
  dateFinValidite!: string | null;

  @ApiProperty({ example: true })
  versionCourante!: boolean;

  @ApiProperty({ example: true })
  estActif!: boolean;

  @ApiProperty({ type: String, format: 'date-time' })
  dateCreation!: Date;

  @ApiProperty({ example: 'system' })
  utilisateurCreation!: string;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  dateModification!: Date | null;

  @ApiPropertyOptional({ example: 'admin@miznas.local', nullable: true })
  utilisateurModification!: string | null;

  @ApiPropertyOptional({
    enum: ['nouvelle_version', 'ecrasement_intra_jour', 'in_place_est_actif'],
  })
  modeMaj?: ModeMajCompte;

  @ApiPropertyOptional({
    example: 0,
    description:
      'Nombre de comptes enfants repointés vers la nouvelle version (stratégie A auto-référence — cf. scd2-pattern.md §8).',
  })
  comptesEnfantsRelinked?: number;
}
