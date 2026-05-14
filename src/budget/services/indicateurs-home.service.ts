/**
 * IndicateursHomeService (Lot 7.2) — résout automatiquement le triplet
 * (version, scénario, exercice) à utiliser pour la bande KPI de la
 * page d'accueil, puis délègue le calcul à `IndicateursService`.
 *
 * Algorithme de résolution (cf. spec Lot 7.2) :
 *  1. Version : la plus récente dont `statutPublication = 'ACTIVE'`,
 *     dans l'ordre `gele → valide → soumis`. Tri par date de la
 *     transition correspondante (`dateGel` / `dateValidation` /
 *     `dateSoumission`) DESC.
 *  2. Scénario : le scénario `typeScenario='central'`, `statut='actif'`,
 *     `exerciceFiscal = <exercice de la version>`. Fallback héritage
 *     Lot 2.4 : 1er scénario `central` `actif` (n'importe quel
 *     exercice, y compris NULL) si rien trouvé.
 *  3. Si triplet complet → délégation à
 *     `indicateursService.getIndicateursGlobaux` (filtrage RBAC
 *     périmètre Q5 garanti par le service).
 *
 * En l'absence de version ou de scénario éligible, retourne
 * `{ defauts: null, indicateurs: null }` (200 OK) pour permettre à la
 * home d'afficher un état vide propre, sans 404 brut.
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';

import type { AuthUser } from '../../auth/decorators/current-user.decorator';
import { DimScenario } from '../../referentiels/scenario/entities/dim-scenario.entity';
import {
  DimVersion,
  StatutVersion,
} from '../../referentiels/version/entities/dim-version.entity';
import {
  IndicateursHomeDefautsDto,
  IndicateursHomeDto,
} from '../dto/indicateurs-home.dto';
import { IndicateursService } from './indicateurs.service';

@Injectable()
export class IndicateursHomeService {
  constructor(
    @InjectRepository(DimVersion)
    private readonly versionRepo: Repository<DimVersion>,
    @InjectRepository(DimScenario)
    private readonly scenarioRepo: Repository<DimScenario>,
    private readonly indicateursService: IndicateursService,
  ) {}

  async getHome(user: AuthUser): Promise<IndicateursHomeDto> {
    const version = await this.resolveVersion();
    if (!version) {
      return { defauts: null, indicateurs: null };
    }

    const scenario = await this.resolveScenario(version.exerciceFiscal);
    if (!scenario) {
      return { defauts: null, indicateurs: null };
    }

    const defauts: IndicateursHomeDefautsDto = {
      versionId: String(version.id),
      codeVersion: version.codeVersion,
      libelleVersion: version.libelle,
      scenarioId: String(scenario.id),
      codeScenario: scenario.codeScenario,
      libelleScenario: scenario.libelle,
      exerciceFiscal: version.exerciceFiscal,
    };

    const indicateurs = await this.indicateursService.getIndicateursGlobaux(
      {
        versionId: defauts.versionId,
        scenarioId: defauts.scenarioId,
        exerciceFiscal: defauts.exerciceFiscal,
      },
      user,
    );

    return { defauts, indicateurs };
  }

  private async resolveVersion(): Promise<DimVersion | null> {
    // Cascade gele → valide → soumis. On exclut les reforecast OBSOLETE
    // (statutPublication par défaut = 'ACTIVE' pour les types non
    // reforecast, donc ce filtre est neutre pour budget_initial).
    const cascades: Array<{
      statut: StatutVersion;
      orderField: keyof DimVersion;
    }> = [
      { statut: 'gele', orderField: 'dateGel' },
      { statut: 'valide', orderField: 'dateValidation' },
      { statut: 'soumis', orderField: 'dateSoumission' },
    ];

    for (const { statut, orderField } of cascades) {
      const found = await this.versionRepo.findOne({
        where: {
          statut,
          statutPublication: 'ACTIVE',
        },
        order: {
          [orderField]: 'DESC',
          dateCreation: 'DESC',
        },
      });
      if (found) return found;
    }
    return null;
  }

  private async resolveScenario(
    exerciceFiscal: number,
  ): Promise<DimScenario | null> {
    // 1. Scénario central rattaché explicitement à l'exercice (cas
    //    standard depuis Lot 3.2 — hook Q9 garantit MEDIAN_<exercice>).
    const exact = await this.scenarioRepo.findOne({
      where: {
        typeScenario: 'central',
        statut: 'actif',
        exerciceFiscal,
      },
      order: { codeScenario: 'ASC' },
    });
    if (exact) return exact;

    // 2. Fallback héritage Lot 2.4 : un scénario central actif sans
    //    exerciceFiscal renseigné peut subsister sur les bases
    //    migrées. On préfère un tel scénario à un retour vide.
    const fallback = await this.scenarioRepo.findOne({
      where: {
        typeScenario: 'central',
        statut: 'actif',
        exerciceFiscal: IsNull(),
      },
      order: { codeScenario: 'ASC' },
    });
    if (fallback) return fallback;

    // 3. Dernier recours : tout scénario central actif, peu importe
    //    l'exercice (situation rare, mais on évite de retourner null
    //    si la donnée existe sous une autre année).
    const any = await this.scenarioRepo.findOne({
      where: {
        typeScenario: 'central',
        statut: 'actif',
        exerciceFiscal: Not(IsNull()),
      },
      order: { codeScenario: 'ASC' },
    });
    return any ?? null;
  }
}
