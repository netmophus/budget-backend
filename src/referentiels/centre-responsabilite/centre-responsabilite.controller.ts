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
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import { Auditable } from '../../audit/decorators/auditable.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthUser } from '../../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator';
import { CentreResponsabiliteService } from './centre-responsabilite.service';
import { CrResponseDto } from './dto/cr-response.dto';
import { CreateCrDto } from './dto/create-cr.dto';
import { ListCrsQueryDto } from './dto/list-crs-query.dto';
import { PaginatedCrsDto } from './dto/paginated-crs.dto';
import { UpdateCrDto } from './dto/update-cr.dto';

@ApiTags('referentiels-cr')
@ApiBearerAuth()
@Controller('referentiels/cr')
export class CentreResponsabiliteController {
  constructor(private readonly crService: CentreResponsabiliteService) {}

  @Get()
  @RequirePermissions('REFERENTIEL.LIRE')
  @ApiOperation({
    summary: 'Liste paginée des CR (filtres codeStructure, typeCr, search).',
  })
  @ApiOkResponse({ type: PaginatedCrsDto })
  findAll(@Query() query: ListCrsQueryDto): Promise<PaginatedCrsDto> {
    return this.crService.findAllPaginated(query);
  }

  @Get('par-code/:codeCr')
  @RequirePermissions('REFERENTIEL.LIRE')
  @ApiOperation({ summary: 'Version courante par code business.' })
  @ApiOkResponse({ type: CrResponseDto })
  @ApiNotFoundResponse()
  findByCode(@Param('codeCr') codeCr: string): Promise<CrResponseDto> {
    return this.crService.findCurrentByCode(codeCr);
  }

  @Get('par-code/:codeCr/historique')
  @RequirePermissions('REFERENTIEL.LIRE')
  @ApiOperation({ summary: 'Historique chronologique du CR.' })
  @ApiOkResponse({ type: [CrResponseDto] })
  findHistory(@Param('codeCr') codeCr: string): Promise<CrResponseDto[]> {
    return this.crService.findHistoryByCode(codeCr);
  }

  @Get('par-structure/:codeStructure')
  @RequirePermissions('REFERENTIEL.LIRE')
  @ApiOperation({ summary: 'Liste les CR rattachés à une structure (courante).' })
  @ApiOkResponse({ type: [CrResponseDto] })
  findByStructure(
    @Param('codeStructure') codeStructure: string,
  ): Promise<CrResponseDto[]> {
    return this.crService.findByStructureCode(codeStructure);
  }

  @Get(':id')
  @RequirePermissions('REFERENTIEL.LIRE')
  @ApiOperation({ summary: 'CR par surrogate key.' })
  @ApiOkResponse({ type: CrResponseDto })
  @ApiNotFoundResponse()
  findOne(@Param('id') id: string): Promise<CrResponseDto> {
    return this.crService.findOneResponse(id);
  }

  @Post()
  @RequirePermissions('REFERENTIEL.GERER')
  @Auditable({
    typeAction: 'CREATE',
    entiteCible: 'dim_centre_responsabilite',
  })
  @ApiOperation({ summary: 'Crée un nouveau CR (REFERENTIEL.GERER).' })
  @ApiCreatedResponse({ type: CrResponseDto })
  @ApiConflictResponse({ description: 'codeCr déjà existant en version courante.' })
  @ApiUnprocessableEntityResponse({
    description: 'Structure parente inexistante / archivée, ou ni fkStructure ni codeStructure fourni.',
  })
  @ApiBadRequestResponse({ description: 'Validation DTO invalide.' })
  create(
    @Body() dto: CreateCrDto,
    @CurrentUser() user: AuthUser,
  ): Promise<CrResponseDto> {
    return this.crService.create(dto, user.email);
  }

  @Patch('par-code/:codeCr')
  @RequirePermissions('REFERENTIEL.GERER')
  @Auditable({
    typeAction: 'UPDATE',
    entiteCible: 'dim_centre_responsabilite',
    extractIdCible: (req) =>
      (req.params as { codeCr?: string }).codeCr ?? null,
  })
  @ApiOperation({
    summary:
      'Modifie un CR. Sémantique 4-cas (modeMaj dans la réponse) : nouvelle_version / ecrasement_intra_jour / in_place_est_actif.',
  })
  @ApiOkResponse({ type: CrResponseDto })
  @ApiNotFoundResponse()
  @ApiUnprocessableEntityResponse()
  update(
    @Param('codeCr') codeCr: string,
    @Body() dto: UpdateCrDto,
    @CurrentUser() user: AuthUser,
  ): Promise<CrResponseDto> {
    return this.crService.update(codeCr, dto, user.email);
  }

  @Delete('par-code/:codeCr')
  @RequirePermissions('REFERENTIEL.GERER')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Auditable({
    typeAction: 'DELETE',
    entiteCible: 'dim_centre_responsabilite',
    extractIdCible: (req) =>
      (req.params as { codeCr?: string }).codeCr ?? null,
  })
  @ApiOperation({ summary: 'Désactive (soft-close) la version courante du CR.' })
  @ApiNoContentResponse()
  @ApiNotFoundResponse()
  async desactiver(
    @Param('codeCr') codeCr: string,
    @CurrentUser() user: AuthUser,
  ): Promise<void> {
    await this.crService.desactiver(codeCr, user.email);
  }
}
