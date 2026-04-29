import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { Auditable } from '../../audit/decorators/auditable.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthUser } from '../../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator';
import { CreateSegmentDto } from './dto/create-segment.dto';
import { ListSegmentsQueryDto } from './dto/list-segments-query.dto';
import { PaginatedSegmentsDto } from './dto/paginated-segments.dto';
import { SegmentResponseDto } from './dto/segment-response.dto';
import { UpdateSegmentDto } from './dto/update-segment.dto';
import { SegmentService } from './segment.service';

/**
 * Pas de routes hiérarchiques (`/racines`, `/:id/enfants`, etc.) :
 * `dim_segment` est volontairement plat au MVP — cf.
 * `docs/modele-donnees.md` §3.7. 7 routes au total.
 */
@ApiTags('referentiels-segment')
@ApiBearerAuth()
@Controller('referentiels/segments')
export class SegmentController {
  constructor(private readonly segmentService: SegmentService) {}

  // ─── Lecture

  @Get()
  @RequirePermissions('REFERENTIEL.LIRE')
  @ApiOperation({
    summary: 'Liste paginée des segments (filtres categorie, search libellé).',
  })
  @ApiOkResponse({ type: PaginatedSegmentsDto })
  findAll(@Query() query: ListSegmentsQueryDto): Promise<PaginatedSegmentsDto> {
    return this.segmentService.findAllPaginated(query);
  }

  @Get('par-code/:codeSegment')
  @RequirePermissions('REFERENTIEL.LIRE')
  @ApiOperation({ summary: 'Version courante par code business.' })
  @ApiOkResponse({ type: SegmentResponseDto })
  @ApiNotFoundResponse()
  findByCode(
    @Param('codeSegment') codeSegment: string,
  ): Promise<SegmentResponseDto> {
    return this.segmentService.findCurrentByCode(codeSegment);
  }

  @Get('par-code/:codeSegment/historique')
  @RequirePermissions('REFERENTIEL.LIRE')
  @ApiOperation({ summary: 'Historique chronologique du segment.' })
  @ApiOkResponse({ type: [SegmentResponseDto] })
  findHistory(
    @Param('codeSegment') codeSegment: string,
  ): Promise<SegmentResponseDto[]> {
    return this.segmentService.findHistoryByCode(codeSegment);
  }

  @Get(':id')
  @RequirePermissions('REFERENTIEL.LIRE')
  @ApiOperation({ summary: 'Segment par surrogate key.' })
  @ApiOkResponse({ type: SegmentResponseDto })
  @ApiNotFoundResponse()
  findOne(@Param('id') id: string): Promise<SegmentResponseDto> {
    return this.segmentService.findOneResponse(id);
  }

  // ─── Mutation

  @Post()
  @RequirePermissions('REFERENTIEL.GERER')
  @Auditable({ typeAction: 'CREATE', entiteCible: 'dim_segment' })
  @ApiOperation({ summary: 'Crée un nouveau segment (REFERENTIEL.GERER).' })
  @ApiCreatedResponse({ type: SegmentResponseDto })
  @ApiConflictResponse({ description: 'codeSegment déjà existant.' })
  @ApiBadRequestResponse({ description: 'Validation DTO invalide.' })
  create(
    @Body() dto: CreateSegmentDto,
    @CurrentUser() user: AuthUser,
  ): Promise<SegmentResponseDto> {
    return this.segmentService.create(dto, user.email);
  }

  @Patch('par-code/:codeSegment')
  @RequirePermissions('REFERENTIEL.GERER')
  @Auditable({
    typeAction: 'UPDATE',
    entiteCible: 'dim_segment',
    extractIdCible: (req) =>
      (req.params as { codeSegment?: string }).codeSegment ?? null,
  })
  @ApiOperation({ summary: 'Modifie un segment (sémantique 4-cas).' })
  @ApiOkResponse({ type: SegmentResponseDto })
  @ApiNotFoundResponse()
  update(
    @Param('codeSegment') codeSegment: string,
    @Body() dto: UpdateSegmentDto,
    @CurrentUser() user: AuthUser,
  ): Promise<SegmentResponseDto> {
    return this.segmentService.update(codeSegment, dto, user.email);
  }

  @Delete('par-code/:codeSegment')
  @RequirePermissions('REFERENTIEL.GERER')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Auditable({
    typeAction: 'DELETE',
    entiteCible: 'dim_segment',
    extractIdCible: (req) =>
      (req.params as { codeSegment?: string }).codeSegment ?? null,
  })
  @ApiOperation({ summary: 'Désactive (soft-close) la version courante.' })
  @ApiNoContentResponse()
  @ApiNotFoundResponse()
  async desactiver(
    @Param('codeSegment') codeSegment: string,
    @CurrentUser() user: AuthUser,
  ): Promise<void> {
    await this.segmentService.desactiver(codeSegment, user.email);
  }
}
