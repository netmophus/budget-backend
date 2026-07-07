import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
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
import { PermissionsService } from '../auth/permissions.service';
import { AnalyseIaService } from './analyse-ia.service';
import {
  AnalyseIaDetailDto,
  ListerAnalysesIaQueryDto,
  PaginatedAnalysesIaDto,
} from './dto/analyse-ia.dto';

@ApiTags('analyses-ia')
@ApiBearerAuth()
@Controller('analyses-ia')
export class AnalyseIaController {
  constructor(
    private readonly service: AnalyseIaService,
    private readonly permissionsService: PermissionsService,
  ) {}

  @Get()
  @RequirePermissions('AI.ANALYSER')
  @ApiOperation({
    summary:
      "Historique des analyses MIZNAS AI. Un porteur d'AI.HISTORIQUE voit toutes les analyses ; sinon l'utilisateur ne voit que les siennes. Paginé, trié par date décroissante. Chantier C1.",
  })
  @ApiOkResponse({ type: PaginatedAnalysesIaDto })
  async lister(
    @Query() query: ListerAnalysesIaQueryDto,
    @CurrentUser() user: AuthUser,
  ): Promise<PaginatedAnalysesIaDto> {
    const peutToutVoir = await this.permissionsService.hasPermission(
      user.userId,
      ['AI.HISTORIQUE'],
    );
    return peutToutVoir
      ? this.service.listerTout(query)
      : this.service.listerPourUser(user.userId, query);
  }

  @Get(':id')
  @RequirePermissions('AI.ANALYSER')
  @ApiOperation({
    summary:
      "Détail d'une analyse historisée (markdown + kpi_snapshot). Accès : propriétaire OU AI.HISTORIQUE. Trace une consultation. Chantier C1.",
  })
  @ApiOkResponse({ type: AnalyseIaDetailDto })
  getDetail(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<AnalyseIaDetailDto> {
    return this.service.getDetail(id, user);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('AI.HISTORIQUE')
  @ApiOperation({
    summary:
      "Supprime une analyse historisée (réservé aux porteurs d'AI.HISTORIQUE — ADMIN/AUDITEUR). Chantier C1.",
  })
  async supprimer(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<{ supprime: boolean }> {
    await this.service.supprimer(id, user);
    return { supprime: true };
  }
}
