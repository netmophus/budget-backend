/**
 * IndicateursController (Lot 3.6) — endpoints REST des indicateurs
 * consolidés (PNB / MNI / Coefficient d'exploitation).
 *
 * Accès : permission `BUDGET.LIRE` pour tous les endpoints (y compris
 * `POST /refresh` — tout utilisateur ayant l'accès en lecture peut
 * déclencher un rafraîchissement manuel).
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthUser } from '../../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator';
import { IndicateursHomeDto } from '../dto/indicateurs-home.dto';
import {
  IndicateursComparaisonDto,
  IndicateursComparaisonFiltersDto,
  IndicateursFiltersDto,
  IndicateursGlobauxDto,
  IndicateursParCrDto,
  RefreshIndicateursResponseDto,
} from '../dto/indicateurs.dto';
import { IndicateursHomeService } from '../services/indicateurs-home.service';
import { IndicateursService } from '../services/indicateurs.service';

@ApiTags('budget-indicateurs')
@ApiBearerAuth()
@Controller('budget/indicateurs')
export class IndicateursController {
  constructor(
    private readonly service: IndicateursService,
    private readonly homeService: IndicateursHomeService,
  ) {}

  /**
   * Endpoint dédié à la bande KPI de la page d'accueil (Lot 7.2).
   * Résout automatiquement le triplet (version / scénario / exercice) :
   *  - Version : la plus récente en `gele`, fallback `valide`, puis
   *    `soumis` (statutPublication = 'ACTIVE' uniquement).
   *  - Scénario : le scénario `central` `actif` rattaché à l'exercice
   *    de la version retenue (fallback héritage Lot 2.4 sur les
   *    scénarios sans exerciceFiscal).
   *  - Indicateurs calculés via `IndicateursService` avec filtrage
   *    périmètre Q5.
   *
   * Renvoie `{ defauts: null, indicateurs: null }` (200 OK) si aucune
   * version éligible — le frontend affiche un état vide propre.
   */
  @Get('home')
  @RequirePermissions('BUDGET.LIRE')
  @ApiOperation({
    summary:
      "KPI par défaut pour la page d'accueil — résout automatiquement " +
      'la dernière version éligible, son scénario central, et calcule ' +
      'les indicateurs globaux pour ce triplet.',
  })
  @ApiOkResponse({ type: IndicateursHomeDto })
  getHome(@CurrentUser() user: AuthUser): Promise<IndicateursHomeDto> {
    return this.homeService.getHome(user);
  }

  @Get('globaux')
  @RequirePermissions('BUDGET.LIRE')
  @ApiOperation({
    summary:
      'Indicateurs consolidés sur le périmètre user (toutes classes, ' +
      "tous CR autorisés). PNB / MNI / Coefficient d'exploitation.",
  })
  @ApiOkResponse({ type: IndicateursGlobauxDto })
  getGlobaux(
    @Query() filters: IndicateursFiltersDto,
    @CurrentUser() user: AuthUser,
  ): Promise<IndicateursGlobauxDto> {
    return this.service.getIndicateursGlobaux(filters, user);
  }

  @Get('par-cr')
  @RequirePermissions('BUDGET.LIRE')
  @ApiOperation({
    summary:
      'Indicateurs par CR (drill-down Q16) — 1 ligne par centre de ' +
      "responsabilité accessible à l'utilisateur.",
  })
  @ApiOkResponse({ type: IndicateursParCrDto, isArray: true })
  getParCr(
    @Query() filters: IndicateursFiltersDto,
    @CurrentUser() user: AuthUser,
  ): Promise<IndicateursParCrDto[]> {
    return this.service.getIndicateursParCr(filters, user);
  }

  @Get('comparaison')
  @RequirePermissions('BUDGET.LIRE')
  @ApiOperation({
    summary:
      'Comparaison côte à côte des scénarios pour la version sélectionnée (Q17).',
  })
  @ApiOkResponse({ type: IndicateursComparaisonDto })
  getComparaison(
    @Query() filters: IndicateursComparaisonFiltersDto,
    @CurrentUser() user: AuthUser,
  ): Promise<IndicateursComparaisonDto> {
    return this.service.getIndicateursComparaison(filters, user);
  }

  // L'audit RECALCUL_INDICATEURS est écrit par IndicateursService
  // avec payloadApres riche (dureeMs, nbLignes). Pas de @Auditable
  // ici pour éviter une double entrée (cf. pattern Lot 3.5 workflow).
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('BUDGET.LIRE')
  @ApiOperation({
    summary:
      'Rafraîchit la vue matérialisée mv_indicateurs_budget ' +
      '(REFRESH MATERIALIZED VIEW CONCURRENTLY). Action consignée ' +
      'dans audit_log (RECALCUL_INDICATEURS).',
  })
  @ApiOkResponse({ type: RefreshIndicateursResponseDto })
  refresh(
    @Body() _body: Record<string, never>,
    @CurrentUser() user: AuthUser,
  ): Promise<RefreshIndicateursResponseDto> {
    return this.service.refreshIndicateurs(user);
  }
}
