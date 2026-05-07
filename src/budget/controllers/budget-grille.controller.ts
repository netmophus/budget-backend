/**
 * BudgetGrilleController (Lot 3.3) — endpoints orchestrant la grille
 * de saisie budgétaire :
 *
 * - `GET  /api/v1/budget/grille` : matrice (compte feuille × 12 mois)
 *   pour un (version, scenario, CR) donné.
 * - `POST /api/v1/budget/grille` : saisie en lot transactionnelle.
 *
 * Filtrage périmètre Q5 appliqué via PerimetreService consommé par
 * BudgetSaisieService.
 */
import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { Auditable } from '../../audit/decorators/auditable.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthUser } from '../../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator';
import {
  GetGrilleSaisieQueryDto,
  GrilleSaisieReponseDto,
  PostGrilleSaisieDto,
  PostGrilleSaisieReponseDto,
} from '../dto/grille-saisie.dto';
import { BudgetSaisieService } from '../services/budget-saisie.service';

@ApiTags('budget-grille')
@ApiBearerAuth()
@Controller('budget/grille')
export class BudgetGrilleController {
  constructor(private readonly service: BudgetSaisieService) {}

  @Get()
  // Lot Administration ADMIN.D — la consultation read-only de la grille
  // exige BUDGET.LIRE (pas BUDGET.SAISIR). Permet à un VALIDATEUR de
  // visualiser le contenu sans avoir besoin du droit d'écriture.
  // Le filtrage par périmètre RBAC est appliqué par PerimetreService.
  @RequirePermissions('BUDGET.LIRE')
  @ApiOperation({
    summary:
      'Matrice de saisie pour (version × scenario × CR × exercice). 12 mois × N comptes feuilles. Filtré par périmètre RBAC.',
  })
  @ApiOkResponse({ type: GrilleSaisieReponseDto })
  getGrille(
    @Query() query: GetGrilleSaisieQueryDto,
    @CurrentUser() user: AuthUser,
  ): Promise<GrilleSaisieReponseDto> {
    return this.service.getGrilleSaisie(
      {
        versionId: query.versionId,
        scenarioId: query.scenarioId,
        crId: query.crId,
        exerciceFiscal: query.exerciceFiscal,
        ligneMetierId: query.ligneMetierId,
        ...(query.classeCompte ? { classeCompte: query.classeCompte } : {}),
      },
      user.userId,
    );
  }

  @Post()
  @RequirePermissions('BUDGET.SAISIR')
  @Auditable({
    typeAction: 'IMPORT_BUDGET',
    entiteCible: 'fait_budget',
  })
  @ApiOperation({
    summary:
      "Saisie en lot d'une grille (compte × ligne_metier × 12 mois). Transactionnelle. Audit IMPORT_BUDGET unique. Insert/update/delete intelligent par cellule.",
  })
  @ApiCreatedResponse({ type: PostGrilleSaisieReponseDto })
  saveGrille(
    @Body() dto: PostGrilleSaisieDto,
    @CurrentUser() user: AuthUser,
  ): Promise<PostGrilleSaisieReponseDto> {
    return this.service.saveGrilleSaisie(dto, user.userId, user.email);
  }
}
