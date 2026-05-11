/**
 * ReforecastController (Lot 5.3.A) — endpoints REST du reforecast
 * trimestriel.
 *
 * RBAC : BUDGET.REFORECAST_LANCER pour lancer(), permissions
 * existantes BUDGET.LIRE / SOUMETTRE / VALIDER / PUBLIER pour le
 * workflow (réutilise VersionWorkflowService Lot 3.5).
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { BudgetSaisieService } from '../budget/services/budget-saisie.service';
import type { GrilleSaisieReponseDto } from '../budget/dto/grille-saisie.dto';
import { VersionWorkflowService } from '../referentiels/version/version-workflow.service';
import {
  ComparaisonResponseDto,
  LancerReforecastDto,
  ListerReforecastsDto,
  PublierReforecastDto,
  RejeterReforecastDto,
  ReforecastResponseDto,
  SoumettreReforecastDto,
  ValiderReforecastDto,
  mapStatutWorkflowParam,
} from './dto/reforecast.dto';
import { ReforecastService } from './reforecast.service';

@ApiTags('reforecast')
@ApiBearerAuth()
@Controller('reforecast')
export class ReforecastController {
  constructor(
    private readonly reforecastService: ReforecastService,
    private readonly workflowService: VersionWorkflowService,
    private readonly budgetSaisieService: BudgetSaisieService,
  ) {}

  // ─── Lancer un reforecast ──────────────────────────────────────

  @Post('lancer')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('BUDGET.REFORECAST_LANCER')
  @ApiOperation({
    summary:
      "Crée une version REFORECAST en BROUILLON à partir d'une version publiée + un trimestre consolidé. Génère les lignes fait_budget extrapolées selon la méthode choisie. Marque OBSOLETE tout reforecast ACTIVE pré-existant pour la même clé.",
  })
  @ApiOkResponse({ type: ReforecastResponseDto })
  lancer(
    @Body() dto: LancerReforecastDto,
    @CurrentUser() user: AuthUser,
  ): Promise<ReforecastResponseDto> {
    return this.reforecastService.lancer(dto, user);
  }

  // ─── Listing / détail ──────────────────────────────────────────

  @Get()
  @RequirePermissions('BUDGET.LIRE')
  @ApiOperation({
    summary:
      'Liste des reforecasts. Filtré par défaut sur statut_publication=ACTIVE.',
  })
  lister(
    @Query() filtres: ListerReforecastsDto,
  ): Promise<ReforecastResponseDto[]> {
    return this.reforecastService.lister({
      ...filtres,
      statutWorkflow: mapStatutWorkflowParam(filtres.statutWorkflow),
    });
  }

  @Get(':id')
  @RequirePermissions('BUDGET.LIRE')
  @ApiOperation({
    summary: "Détail d'un reforecast (avec métadonnées source).",
  })
  getById(@Param('id') id: string): Promise<ReforecastResponseDto> {
    return this.reforecastService.getById(id);
  }

  @Get(':id/grille')
  @RequirePermissions('BUDGET.LIRE')
  @ApiOperation({
    summary:
      'Grille de saisie du reforecast (matrice compte × 12 mois). Délègue à BudgetSaisieService.',
  })
  async getGrille(
    @Param('id') id: string,
    @Query('crId') crId: string,
    @Query('ligneMetierId') ligneMetierId: string,
    @Query('classeCompte') classeCompte: string | undefined,
    @CurrentUser() user: AuthUser,
  ): Promise<GrilleSaisieReponseDto> {
    const v = await this.reforecastService.getEntityById(id);
    return this.budgetSaisieService.getGrilleSaisie(
      {
        versionId: v.id,
        scenarioId: v.fkScenarioSource!,
        crId,
        exerciceFiscal: v.exerciceFiscal,
        ligneMetierId,
        ...(classeCompte ? { classeCompte } : {}),
      },
      user.userId,
    );
  }

  @Get(':id/comparaison')
  @RequirePermissions('BUDGET.LIRE')
  @ApiOperation({
    summary:
      'Comparaison ligne à ligne du reforecast vs sa version source (+ origine REALISE/EXTRAPOLATION/MANUEL).',
  })
  @ApiOkResponse({ type: ComparaisonResponseDto })
  getComparaison(@Param('id') id: string): Promise<ComparaisonResponseDto> {
    return this.reforecastService.getComparaison(id);
  }

  // ─── Workflow (réutilise VersionWorkflowService) ───────────────

  @Post(':id/soumettre')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('BUDGET.SOUMETTRE')
  @ApiOperation({
    summary:
      "Soumet un reforecast à validation. Audit SOUMETTRE_REFORECAST émis (au lieu de SOUMETTRE_BUDGET) car type_version='reforecast'.",
  })
  async soumettre(
    @Param('id') id: string,
    @Body() dto: SoumettreReforecastDto,
    @CurrentUser() user: AuthUser,
  ): Promise<ReforecastResponseDto> {
    await this.reforecastService.getEntityById(id); // 404 si pas reforecast
    await this.workflowService.soumettre(id, dto, user);
    return this.reforecastService.getById(id);
  }

  @Post(':id/valider')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('BUDGET.VALIDER')
  @ApiOperation({ summary: 'Valide un reforecast soumis.' })
  async valider(
    @Param('id') id: string,
    @Body() dto: ValiderReforecastDto,
    @CurrentUser() user: AuthUser,
  ): Promise<ReforecastResponseDto> {
    await this.reforecastService.getEntityById(id);
    await this.workflowService.valider(id, dto, user);
    return this.reforecastService.getById(id);
  }

  @Post(':id/rejeter')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('BUDGET.VALIDER')
  @ApiOperation({
    summary: 'Rejette un reforecast soumis (motif obligatoire).',
  })
  async rejeter(
    @Param('id') id: string,
    @Body() dto: RejeterReforecastDto,
    @CurrentUser() user: AuthUser,
  ): Promise<ReforecastResponseDto> {
    await this.reforecastService.getEntityById(id);
    await this.workflowService.rejeter(id, dto, user);
    return this.reforecastService.getById(id);
  }

  @Post(':id/publier')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('BUDGET.PUBLIER')
  @ApiOperation({
    summary:
      'Publie un reforecast validé (action irréversible — la version devient IMMUABLE).',
  })
  async publier(
    @Param('id') id: string,
    @Body() dto: PublierReforecastDto,
    @CurrentUser() user: AuthUser,
  ): Promise<ReforecastResponseDto> {
    await this.reforecastService.getEntityById(id);
    await this.workflowService.publier(id, dto, user);
    return this.reforecastService.getById(id);
  }
}
