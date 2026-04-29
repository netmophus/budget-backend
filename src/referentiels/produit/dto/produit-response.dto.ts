import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import type { TypeProduit } from '../entities/dim-produit.entity';

/** Cf. `scd2-pattern.md` §7. */
export type ModeMajProduit =
  | 'nouvelle_version'
  | 'ecrasement_intra_jour'
  | 'in_place_est_actif';

/** Vue compacte du parent — embarquée dans la réponse. */
export class ParentProduitDto {
  @ApiProperty({ example: '12' })
  id!: string;

  @ApiProperty({ example: 'CREDIT_TRESORERIE' })
  codeProduit!: string;

  @ApiProperty({ example: 'Crédits de trésorerie' })
  libelle!: string;
}

export class ProduitResponseDto {
  @ApiProperty({ example: '42' })
  id!: string;

  @ApiProperty({ example: 'CREDIT_DECOUVERT' })
  codeProduit!: string;

  @ApiProperty({ example: 'Découverts particuliers' })
  libelle!: string;

  @ApiProperty({ enum: ['credit', 'depot', 'service', 'marche', 'autre'] })
  typeProduit!: TypeProduit;

  @ApiPropertyOptional({ example: '12', nullable: true })
  fkProduitParent!: string | null;

  @ApiPropertyOptional({ type: ParentProduitDto })
  parentCourant?: ParentProduitDto;

  @ApiProperty({ example: 3 })
  niveau!: number;

  @ApiProperty({ example: true })
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
  modeMaj?: ModeMajProduit;

  @ApiPropertyOptional({
    example: 0,
    description:
      'Nombre de produits enfants repointés vers la nouvelle version (stratégie A auto-référence — cf. scd2-pattern.md §8).',
  })
  produitsEnfantsRelinked?: number;
}
