import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import {
  CODES_PAYS_UEMOA,
  CodePaysUemoa,
  TYPES_STRUCTURE,
  TypeStructure,
} from '../entities/dim-structure.entity';

export class StructureResponseDto {
  @ApiProperty({ example: '12' })
  id!: string;

  @ApiProperty({ example: 'AG_ABJ_PLATEAU' })
  codeStructure!: string;

  @ApiProperty({ example: 'Agence Abidjan Plateau' })
  libelle!: string;

  @ApiPropertyOptional({ example: 'Ag. Plateau', nullable: true })
  libelleCourt!: string | null;

  @ApiProperty({ enum: TYPES_STRUCTURE })
  typeStructure!: TypeStructure;

  @ApiProperty({ example: 5 })
  niveauHierarchique!: number;

  @ApiPropertyOptional({ example: '8', nullable: true })
  fkStructureParent!: string | null;

  @ApiPropertyOptional({ enum: CODES_PAYS_UEMOA, nullable: true })
  codePays!: CodePaysUemoa | null;

  @ApiProperty({ example: '2026-05-04', format: 'date' })
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
}
