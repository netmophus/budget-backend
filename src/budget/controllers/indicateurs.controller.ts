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
import {
  IndicateursComparaisonDto,
  IndicateursComparaisonFiltersDto,
  IndicateursFiltersDto,
  IndicateursGlobauxDto,
  IndicateursParCrDto,
  RefreshIndicateursResponseDto,
} from '../dto/indicateurs.dto';
import { IndicateursService } from '../services/indicateurs.service';

@ApiTags('budget-indicateurs')
@ApiBearerAuth()
@Controller('budget/indicateurs')
export class IndicateursController {
  constructor(private readonly service: IndicateursService) {}

  @Get('globaux')
  @RequirePermissions('BUDGET.LIRE')
  @ApiOperation({
    summary:
      'Indicateurs consolidés sur le périmètre user (toutes classes, ' +
      'tous CR autorisés). PNB / MNI / Coefficient d\'exploitation.',
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
      'responsabilité accessible à l\'utilisateur.',
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
