import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import {
  CODES_PAYS_UEMOA,
  TYPES_STRUCTURE,
} from '../entities/dim-structure.entity';
import type {
  CodePaysUemoa,
  TypeStructure,
} from '../entities/dim-structure.entity';

/**
 * Mode d'application d'un PATCH sur une dimension SCD2 (cf. fix 2.3A.1) :
 *  - `nouvelle_version`        : création d'une nouvelle ligne SCD2
 *    (PATCH sur version d'hier ou avant, champ SCD2-tracé modifié)
 *  - `ecrasement_intra_jour`   : mise à jour en place de la version du
 *    jour (PATCH sur version créée aujourd'hui, champ SCD2-tracé modifié)
 *  - `in_place_est_actif`      : mise à jour en place du flag estActif
 *    seul (jamais de nouvelle version, pas de bruit dans l'historique)
 *
 * Champ uniquement renseigné dans les réponses de PATCH ; absent des
 * réponses GET. Tracé dans `audit_log.payload_apres.response.modeMaj`
 * pour audit fin du mode d'application.
 */
export type ModeMajStructure =
  | 'nouvelle_version'
  | 'ecrasement_intra_jour'
  | 'in_place_est_actif';

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

  @ApiPropertyOptional({
    enum: ['nouvelle_version', 'ecrasement_intra_jour', 'in_place_est_actif'],
    description:
      "Présent uniquement dans les réponses de PATCH — indique comment la modification a été appliquée (cf. ModeMajStructure).",
  })
  modeMaj?: ModeMajStructure;

  @ApiPropertyOptional({
    example: 0,
    description:
      "Nombre de CR repointés vers la nouvelle version de structure (stratégie A — cf. scd2-pattern.md §8). Présent uniquement après un PATCH qui a créé une nouvelle version SCD2.",
  })
  crsRelinked?: number;
}
