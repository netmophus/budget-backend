import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { TYPES_CR } from '../entities/dim-centre-responsabilite.entity';
import type { TypeCr } from '../entities/dim-centre-responsabilite.entity';

/** Cf. `scd2-pattern.md` §7. */
export type ModeMajCr =
  | 'nouvelle_version'
  | 'ecrasement_intra_jour'
  | 'in_place_est_actif';

/** Vue compacte de la structure parente — embarquée dans la réponse CR. */
export class StructureCouranteDto {
  @ApiProperty({ example: '12' })
  id!: string;

  @ApiProperty({ example: 'AG_ABJ_PLATEAU' })
  codeStructure!: string;

  @ApiProperty({ example: 'Agence Abidjan Plateau' })
  libelle!: string;
}

export class CrResponseDto {
  @ApiProperty({ example: '5' })
  id!: string;

  @ApiProperty({ example: 'CR_AG_ABJ_PLATEAU' })
  codeCr!: string;

  @ApiProperty({ example: 'CR Agence Plateau' })
  libelle!: string;

  @ApiPropertyOptional({ nullable: true, example: 'CR Plateau' })
  libelleCourt!: string | null;

  @ApiProperty({ enum: TYPES_CR })
  typeCr!: TypeCr;

  @ApiProperty({ example: '12' })
  fkStructure!: string;

  @ApiPropertyOptional({ type: StructureCouranteDto })
  structureCourante?: StructureCouranteDto;

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
  modeMaj?: ModeMajCr;
}
