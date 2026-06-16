import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';

import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthUser } from '../../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator';
import { ExtendCalendrierDto } from './dto/extend-calendrier.dto';
import { ListTempsQueryDto } from './dto/list-temps-query.dto';
import { PaginatedTempsDto } from './dto/paginated-temps.dto';
import { TempsResponseDto } from './dto/temps-response.dto';
import { UpdateJourDto } from './dto/update-jour.dto';
import { TempsService } from './temps.service';

@ApiTags('referentiels-temps')
@ApiBearerAuth()
@Controller('referentiels/temps')
export class TempsController {
  constructor(private readonly tempsService: TempsService) {}

  @Get()
  @RequirePermissions('REFERENTIEL.LIRE')
  @ApiOperation({
    summary:
      'Liste paginée du calendrier (filtres dateDebut/dateFin/annee/mois/exerciceFiscal). Limite 366.',
  })
  @ApiOkResponse({ type: PaginatedTempsDto })
  findAll(@Query() query: ListTempsQueryDto): Promise<PaginatedTempsDto> {
    return this.tempsService.findAll(query);
  }

  @Get('par-date/:date')
  @RequirePermissions('REFERENTIEL.LIRE')
  @ApiOperation({
    summary:
      'Récupère un jour calendaire par sa date métier (format YYYY-MM-DD).',
  })
  @ApiParam({ name: 'date', example: '2026-05-01' })
  @ApiOkResponse({ type: TempsResponseDto })
  findByDate(@Param('date') date: string): Promise<TempsResponseDto> {
    return this.tempsService.findByDate(date);
  }

  @Get(':id')
  @RequirePermissions('REFERENTIEL.LIRE')
  @ApiOperation({ summary: 'Récupère un jour calendaire par son id.' })
  @ApiOkResponse({ type: TempsResponseDto })
  findOne(@Param('id') id: string): Promise<TempsResponseDto> {
    return this.tempsService.findOne(id);
  }

  @Post('etendre')
  @RequirePermissions('REFERENTIEL.GERER')
  @ApiOperation({
    summary:
      'Étend le calendrier sur une plage d’années (Lot 8.7.A). Idempotent : les jours déjà présents sont ignorés. Réservé ADMIN (REFERENTIEL.GERER).',
  })
  @ApiCreatedResponse({
    schema: {
      type: 'object',
      properties: {
        nbJoursAjoutes: { type: 'number', example: 730 },
        message: { type: 'string', example: '730 jours ajoutés au calendrier' },
      },
    },
  })
  etendreCalendrier(
    @Body() dto: ExtendCalendrierDto,
    @CurrentUser() user: AuthUser,
  ): Promise<{ nbJoursAjoutes: number; message: string }> {
    return this.tempsService.etendreCalendrier(dto, user);
  }

  @Patch(':id')
  @RequirePermissions('REFERENTIEL.GERER')
  @ApiOperation({
    summary:
      'Modifie un jour du calendrier (statut ouvré, fins de période, libellé férié). Lot 8.7.A. Réservé ADMIN (REFERENTIEL.GERER).',
  })
  @ApiOkResponse({ type: TempsResponseDto })
  updateJour(
    @Param('id') id: string,
    @Body() dto: UpdateJourDto,
    @CurrentUser() user: AuthUser,
  ): Promise<TempsResponseDto> {
    return this.tempsService.updateJour(id, dto, user);
  }
}
