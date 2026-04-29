import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';

import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator';
import { ListTempsQueryDto } from './dto/list-temps-query.dto';
import { PaginatedTempsDto } from './dto/paginated-temps.dto';
import { TempsResponseDto } from './dto/temps-response.dto';
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
}
