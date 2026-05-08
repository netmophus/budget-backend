/**
 * TableauBordController (Lot 5.2.C) — endpoints du tableau de
 * bord budget vs réalisé. Double permission BUDGET.LIRE +
 * REALISE.LIRE (avec mode 'all').
 */
import {
  Controller,
  Get,
  Header,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import {
  EcartsResponseDto,
  FiltresEcartsDto,
} from './dto/tableau-bord.dto';
import { AnalyseEcartsService } from './services/analyse-ecarts.service';
import { ExportExcelService } from './services/export-excel.service';

@ApiTags('tableau-de-bord')
@ApiBearerAuth()
@Controller('tableau-de-bord')
export class TableauBordController {
  constructor(
    private readonly analyseSvc: AnalyseEcartsService,
    private readonly exportSvc: ExportExcelService,
  ) {}

  @Get('budget-vs-realise')
  @RequirePermissions({ all: ['BUDGET.LIRE', 'REALISE.LIRE'] })
  @ApiOperation({
    summary:
      "Tableau de bord budget vs réalisé. Agrégation par (CR × compte × ligne métier × mois) avec calcul des écarts, niveaux d'alerte (NORMAL/ATTENTION/CRITIQUE/MANQUANT) et sens favorable/défavorable selon classe UEMOA. Filtrage périmètre user_perimetres en lecture.",
  })
  @ApiOkResponse({ type: EcartsResponseDto })
  getBudgetVsRealise(
    @Query() filtres: FiltresEcartsDto,
    @CurrentUser() user: AuthUser,
  ): Promise<EcartsResponseDto> {
    return this.analyseSvc.getBudgetVsRealise(filtres, user);
  }

  @Get('budget-vs-realise/export')
  @RequirePermissions({ all: ['BUDGET.LIRE', 'REALISE.LIRE'] })
  @Header(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  )
  @ApiOperation({
    summary:
      "Export Excel (.xlsx) du tableau de bord. 3 onglets : Synthèse (KPI), Détail des écarts (mise en forme conditionnelle sur la colonne Niveau), Filtres.",
  })
  async exportXlsx(
    @Query() filtres: FiltresEcartsDto,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
  ): Promise<void> {
    const ecarts = await this.analyseSvc.getBudgetVsRealise(filtres, user);
    const buf = await this.exportSvc.genererXlsx(ecarts, filtres.versionId);
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const filename = `ecarts-budget-realise-${filtres.versionId}-${today}.xlsx`;
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename}"`,
    );
    res.setHeader('Content-Length', String(buf.length));
    res.end(buf);
  }
}
