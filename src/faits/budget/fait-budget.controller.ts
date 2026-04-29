import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
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
import { CreateFaitBudgetDto } from './dto/create-fait-budget.dto';
import { FaitBudgetResponseDto } from './dto/fait-budget-response.dto';
import { ListFaitBudgetQueryDto } from './dto/list-fait-budget-query.dto';
import { PaginatedFaitBudgetDto } from './dto/paginated-fait-budget.dto';
import { ParGrainQueryDto } from './dto/par-grain-query.dto';
import { UpdateFaitBudgetDto } from './dto/update-fait-budget.dto';
import { FaitBudgetService } from './fait-budget.service';

@ApiTags('faits-budget')
@ApiBearerAuth()
@Controller('faits/budget')
export class FaitBudgetController {
  constructor(private readonly service: FaitBudgetService) {}

  @Get()
  @RequirePermissions('BUDGET.LIRE')
  @ApiOperation({
    summary:
      'Liste paginée des faits budget (filtres : fkVersion / fkScenario / fkTemps / fkCentre / fkCompte / codeVersion / codeScenario / annee / mois).',
  })
  @ApiOkResponse({ type: PaginatedFaitBudgetDto })
  findAll(
    @Query() query: ListFaitBudgetQueryDto,
  ): Promise<PaginatedFaitBudgetDto> {
    return this.service.findAll(query);
  }

  @Get('par-grain')
  @RequirePermissions('BUDGET.LIRE')
  @ApiOperation({
    summary:
      'Récupère un fait budget par son grain unique (10 FK). 404 si absent.',
  })
  @ApiOkResponse({ type: FaitBudgetResponseDto })
  @ApiNotFoundResponse()
  async findByGrain(
    @Query() query: ParGrainQueryDto,
  ): Promise<FaitBudgetResponseDto> {
    const r = await this.service.findByGrain(query);
    if (!r) {
      throw new NotFoundException(
        'Aucun fait budget trouvé pour ce grain (10-uplet de FK).',
      );
    }
    return r;
  }

  @Get(':id')
  @RequirePermissions('BUDGET.LIRE')
  @ApiOperation({ summary: 'Récupère un fait budget par son id.' })
  @ApiOkResponse({ type: FaitBudgetResponseDto })
  @ApiNotFoundResponse()
  findById(@Param('id') id: string): Promise<FaitBudgetResponseDto> {
    return this.service.findById(id);
  }

  @Post()
  @RequirePermissions('BUDGET.SAISIR')
  @Auditable({ typeAction: 'CREATE', entiteCible: 'fait_budget' })
  @ApiOperation({
    summary:
      "Crée un fait budget. Au Lot 3.2A, le caller fournit les 10 FK explicitement ; la résolution dynamique par codes business + date métier (Option B SCD2) arrive au Lot 3.2B.",
  })
  @ApiCreatedResponse({ type: FaitBudgetResponseDto })
  @ApiConflictResponse({
    description:
      'Grain unique violé (un fait existe déjà pour ce 10-uplet) ou version cible figée.',
  })
  @ApiNotFoundResponse({ description: 'Une des FK pointe vers une dimension inexistante.' })
  @ApiBadRequestResponse({ description: 'Validation DTO invalide.' })
  create(
    @Body() dto: CreateFaitBudgetDto,
    @CurrentUser() user: AuthUser,
  ): Promise<FaitBudgetResponseDto> {
    return this.service.create(dto, user.email);
  }

  @Patch(':id')
  @RequirePermissions('BUDGET.SAISIR')
  @Auditable({
    typeAction: 'UPDATE',
    entiteCible: 'fait_budget',
    extractIdCible: (req) => (req.params as { id?: string }).id ?? null,
  })
  @ApiOperation({
    summary:
      'Modifie les mesures d\'un fait (montantDevise / montantFcfa / tauxChangeApplique). Aucune FK modifiable (un fait modifié = supprimé + recréé).',
  })
  @ApiOkResponse({ type: FaitBudgetResponseDto })
  @ApiNotFoundResponse()
  @ApiUnprocessableEntityResponse({
    description: 'Une FK est présente dans le payload (interdit).',
  })
  @ApiConflictResponse({
    description:
      "La version cible est figée (statut != 'ouvert').",
  })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateFaitBudgetDto,
    @CurrentUser() user: AuthUser,
  ): Promise<FaitBudgetResponseDto> {
    return this.service.update(
      id,
      dto as UpdateFaitBudgetDto & Record<string, unknown>,
      user.email,
    );
  }

  @Delete(':id')
  @RequirePermissions('BUDGET.SUPPRIMER')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Auditable({
    typeAction: 'DELETE',
    entiteCible: 'fait_budget',
    extractIdCible: (req) => (req.params as { id?: string }).id ?? null,
  })
  @ApiOperation({
    summary: "Supprime un fait. Refusé si version cible != 'ouvert'.",
  })
  @ApiNoContentResponse()
  @ApiNotFoundResponse()
  @ApiConflictResponse({
    description: "Version cible figée — suppression refusée.",
  })
  async remove(@Param('id') id: string): Promise<void> {
    const ok = await this.service.remove(id);
    if (!ok) throw new NotFoundException();
  }
}
