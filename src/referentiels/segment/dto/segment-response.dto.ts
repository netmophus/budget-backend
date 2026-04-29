import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import type { CategorieSegment } from '../entities/dim-segment.entity';

/** Cf. `scd2-pattern.md` §7. */
export type ModeMajSegment =
  | 'nouvelle_version'
  | 'ecrasement_intra_jour'
  | 'in_place_est_actif';

export class SegmentResponseDto {
  @ApiProperty({ example: '42' })
  id!: string;

  @ApiProperty({ example: 'PME' })
  codeSegment!: string;

  @ApiProperty({ example: 'Petites et moyennes entreprises' })
  libelle!: string;

  @ApiProperty({
    enum: [
      'particulier',
      'professionnel',
      'pme',
      'grande_entreprise',
      'institutionnel',
      'secteur_public',
    ],
  })
  categorie!: CategorieSegment;

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
  modeMaj?: ModeMajSegment;
}
