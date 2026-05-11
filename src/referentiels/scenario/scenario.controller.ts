import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { Auditable } from '../../audit/decorators/auditable.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthUser } from '../../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator';
import { CreateScenarioDto } from './dto/create-scenario.dto';
import { ListScenariosQueryDto } from './dto/list-scenarios-query.dto';
import { PaginatedScenariosDto } from './dto/paginated-scenarios.dto';
import { ScenarioResponseDto } from './dto/scenario-response.dto';
import { UpdateScenarioDto } from './dto/update-scenario.dto';
import { ScenarioService } from './scenario.service';

@ApiTags('referentiels-scenario')
@ApiBearerAuth()
@Controller('referentiels/scenarios')
export class ScenarioController {
  constructor(private readonly scenarioService: ScenarioService) {}

  @Get()
  @RequirePermissions('REFERENTIEL.LIRE')
  @ApiOperation({
    summary: 'Liste paginée des scénarios (filtres statut, typeScenario).',
  })
  @ApiOkResponse({ type: PaginatedScenariosDto })
  findAll(
    @Query() query: ListScenariosQueryDto,
  ): Promise<PaginatedScenariosDto> {
    return this.scenarioService.findAll(query);
  }

  @Get('par-code/:codeScenario')
  @RequirePermissions('REFERENTIEL.LIRE')
  @ApiOperation({ summary: 'Récupère un scénario par son code business.' })
  @ApiOkResponse({ type: ScenarioResponseDto })
  @ApiNotFoundResponse()
  findByCode(
    @Param('codeScenario') codeScenario: string,
  ): Promise<ScenarioResponseDto> {
    return this.scenarioService.findByCode(codeScenario);
  }

  @Get(':id')
  @RequirePermissions('REFERENTIEL.LIRE')
  @ApiOperation({ summary: 'Récupère un scénario par son id.' })
  @ApiOkResponse({ type: ScenarioResponseDto })
  @ApiNotFoundResponse()
  findOne(@Param('id') id: string): Promise<ScenarioResponseDto> {
    return this.scenarioService.findOne(id);
  }

  @Post()
  @RequirePermissions('REFERENTIEL.GERER')
  @Auditable({ typeAction: 'CREATE', entiteCible: 'dim_scenario' })
  @ApiOperation({
    summary: "Crée un nouveau scénario (statut='actif' systématique).",
  })
  @ApiCreatedResponse({ type: ScenarioResponseDto })
  @ApiConflictResponse({ description: 'codeScenario déjà existant.' })
  create(
    @Body() dto: CreateScenarioDto,
    @CurrentUser() user: AuthUser,
  ): Promise<ScenarioResponseDto> {
    return this.scenarioService.create(dto, user.email);
  }

  @Patch(':id')
  @RequirePermissions('REFERENTIEL.GERER')
  @Auditable({
    typeAction: 'UPDATE',
    entiteCible: 'dim_scenario',
    extractIdCible: (req) => (req.params as { id?: string }).id ?? null,
  })
  @ApiOperation({
    summary: "Modifie un scénario (refus si statut='archive').",
  })
  @ApiOkResponse({ type: ScenarioResponseDto })
  @ApiNotFoundResponse()
  @ApiConflictResponse({
    description: 'Scenario archivé — modification refusée.',
  })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateScenarioDto,
    @CurrentUser() user: AuthUser,
  ): Promise<ScenarioResponseDto> {
    return this.scenarioService.update(id, dto, user.email);
  }

  @Post(':id/archiver')
  @RequirePermissions('REFERENTIEL.GERER')
  @HttpCode(HttpStatus.OK)
  @Auditable({
    typeAction: 'UPDATE',
    entiteCible: 'dim_scenario',
    extractIdCible: (req) => (req.params as { id?: string }).id ?? null,
  })
  @ApiOperation({
    summary:
      'Archive un scénario (transition unique actif → archive). Pas de DELETE physique car les faits référencent ce scénario.',
  })
  @ApiOkResponse({ type: ScenarioResponseDto })
  @ApiNotFoundResponse()
  @ApiConflictResponse({ description: 'Déjà archivé.' })
  archive(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<ScenarioResponseDto> {
    return this.scenarioService.archive(id, user.email);
  }
}
