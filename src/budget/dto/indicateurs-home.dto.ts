import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { IndicateursGlobauxDto } from './indicateurs.dto';

/**
 * Triplet (version, scénario, exercice) résolu automatiquement par
 * `IndicateursHomeService` pour la page d'accueil. Permet au frontend
 * d'afficher en transparence quelle version a été choisie sans
 * imposer de sélecteur sur la home.
 */
export class IndicateursHomeDefautsDto {
  @ApiProperty({ description: 'fk_version retenue' })
  versionId!: string;

  @ApiProperty()
  codeVersion!: string;

  @ApiProperty()
  libelleVersion!: string;

  @ApiProperty({ description: 'fk_scenario retenu (typeScenario=central)' })
  scenarioId!: string;

  @ApiProperty()
  codeScenario!: string;

  @ApiProperty()
  libelleScenario!: string;

  @ApiProperty({ example: 2027 })
  exerciceFiscal!: number;
}

/**
 * Réponse du `GET /budget/indicateurs/home` (Lot 7.2). Si aucune
 * version n'est éligible (workflow vide en début de mise en service),
 * les deux champs sont `null` et le frontend affiche un état vide
 * propre — pas de 404.
 */
export class IndicateursHomeDto {
  @ApiPropertyOptional({
    type: () => IndicateursHomeDefautsDto,
    nullable: true,
    description:
      'Triplet résolu (version + scénario + exercice). null si aucune ' +
      'version éligible.',
  })
  defauts!: IndicateursHomeDefautsDto | null;

  @ApiPropertyOptional({
    type: () => IndicateursGlobauxDto,
    nullable: true,
    description:
      "Indicateurs consolidés sur le périmètre RBAC de l'utilisateur " +
      'pour le triplet ci-dessus. null si `defauts` est null.',
  })
  indicateurs!: IndicateursGlobauxDto | null;
}
