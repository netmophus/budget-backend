import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Cf. `scd2-pattern.md` §7. */
export type ModeMajLigneMetier =
  | 'nouvelle_version'
  | 'ecrasement_intra_jour'
  | 'in_place_est_actif';

/** Vue compacte du parent — embarquée dans la réponse. */
export class ParentLigneMetierDto {
  @ApiProperty({ example: '12' })
  id!: string;

  @ApiProperty({ example: 'RETAIL' })
  codeLigneMetier!: string;

  @ApiProperty({ example: 'Banque de détail' })
  libelle!: string;
}

export class LigneMetierResponseDto {
  @ApiProperty({ example: '42' })
  id!: string;

  @ApiProperty({ example: 'RETAIL_PARTICULIERS' })
  codeLigneMetier!: string;

  @ApiProperty({ example: 'Particuliers' })
  libelle!: string;

  @ApiPropertyOptional({ example: '12', nullable: true })
  fkLigneMetierParent!: string | null;

  @ApiPropertyOptional({ type: ParentLigneMetierDto })
  parentCourant?: ParentLigneMetierDto;

  @ApiProperty({ example: 2 })
  niveau!: number;

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
  modeMaj?: ModeMajLigneMetier;

  @ApiPropertyOptional({
    example: 0,
    description:
      "Nombre de lignes-métier enfants repointées vers la nouvelle version (stratégie A auto-référence — cf. scd2-pattern.md §8).",
  })
  lignesMetierEnfantsRelinked?: number;
}
