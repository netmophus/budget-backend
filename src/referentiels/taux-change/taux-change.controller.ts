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
} from '@nestjs/swagger';

import { Auditable } from '../../audit/decorators/auditable.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthUser } from '../../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator';
import { CreateTauxChangeDto } from './dto/create-taux-change.dto';
import { ListTauxChangeQueryDto } from './dto/list-taux-change-query.dto';
import { PaginatedTauxChangeDto } from './dto/paginated-taux-change.dto';
import {
  TauxApplicableDto,
  TauxChangeResponseDto,
} from './dto/taux-change-response.dto';
import { UpdateTauxChangeDto } from './dto/update-taux-change.dto';
import type { TypeTaux } from './entities/ref-taux-change.entity';
import { TauxChangeService } from './taux-change.service';

@ApiTags('referentiels-taux-change')
@ApiBearerAuth()
@Controller('referentiels/taux-change')
export class TauxChangeController {
  constructor(private readonly tauxService: TauxChangeService) {}

  @Get()
  @RequirePermissions('REFERENTIEL.LIRE')
  @ApiOperation({
    summary:
      'Liste paginée des taux de change (filtres codeDevise / dateDebut / dateFin / typeTaux).',
  })
  @ApiOkResponse({ type: PaginatedTauxChangeDto })
  findAll(
    @Query() query: ListTauxChangeQueryDto,
  ): Promise<PaginatedTauxChangeDto> {
    return this.tauxService.findAll(query);
  }

  @Get('applicable')
  @RequirePermissions('REFERENTIEL.LIRE')
  @ApiOperation({
    summary:
      "Résout le taux applicable à une date donnée (date exacte ou dernier taux antérieur). Utilisé en Lot 3.2 pour le calcul automatique de montant_fcfa.",
  })
  @ApiOkResponse({ type: TauxApplicableDto })
  @ApiNotFoundResponse({
    description: 'Aucun taux trouvé pour ce (codeDevise, typeTaux) à cette date.',
  })
  @ApiBadRequestResponse({ description: 'Query manquante ou mal formée.' })
  async findApplicable(
    @Query('codeDevise') codeDevise: string,
    @Query('date') date: string,
    @Query('typeTaux') typeTaux: TypeTaux,
  ): Promise<TauxApplicableDto> {
    if (!codeDevise || !date || !typeTaux) {
      throw new NotFoundException(
        'Paramètres requis : codeDevise, date, typeTaux.',
      );
    }
    const taux = await this.tauxService.findTauxApplicable(
      codeDevise,
      date,
      typeTaux,
    );
    if (!taux) {
      throw new NotFoundException(
        `Aucun taux ${typeTaux} trouvé pour ${codeDevise} à la date ${date} (ni date exacte ni taux antérieur).`,
      );
    }
    return taux;
  }

  @Get(':id')
  @RequirePermissions('REFERENTIEL.LIRE')
  @ApiOperation({ summary: 'Récupère un taux par son id.' })
  @ApiOkResponse({ type: TauxChangeResponseDto })
  @ApiNotFoundResponse()
  findOne(@Param('id') id: string): Promise<TauxChangeResponseDto> {
    return this.tauxService.findOne(id);
  }

  @Post()
  @RequirePermissions('REFERENTIEL.GERER')
  @Auditable({ typeAction: 'CREATE', entiteCible: 'ref_taux_change' })
  @ApiOperation({
    summary:
      'Crée un nouveau taux de change (codeDevise + date résolus en fkDevise + fkTemps).',
  })
  @ApiCreatedResponse({ type: TauxChangeResponseDto })
  @ApiConflictResponse({
    description:
      'Triplet (devise, date, typeTaux) déjà existant.',
  })
  create(
    @Body() dto: CreateTauxChangeDto,
    @CurrentUser() user: AuthUser,
  ): Promise<TauxChangeResponseDto> {
    return this.tauxService.create(dto, user.email);
  }

  @Patch(':id')
  @RequirePermissions('REFERENTIEL.GERER')
  @Auditable({
    typeAction: 'UPDATE',
    entiteCible: 'ref_taux_change',
    extractIdCible: (req) => (req.params as { id?: string }).id ?? null,
  })
  @ApiOperation({
    summary:
      'Modifie un taux (seuls tauxVersPivot et source sont modifiables).',
  })
  @ApiOkResponse({ type: TauxChangeResponseDto })
  @ApiNotFoundResponse()
  update(
    @Param('id') id: string,
    @Body() dto: UpdateTauxChangeDto,
  ): Promise<TauxChangeResponseDto> {
    return this.tauxService.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('REFERENTIEL.GERER')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Auditable({
    typeAction: 'DELETE',
    entiteCible: 'ref_taux_change',
    extractIdCible: (req) => (req.params as { id?: string }).id ?? null,
  })
  @ApiOperation({
    summary:
      'Supprime un taux. Autorisé : aucun fait n\'a de FK sortante vers ref_taux_change (le taux est copié dans fait_budget).',
  })
  @ApiNoContentResponse()
  @ApiNotFoundResponse()
  async remove(@Param('id') id: string): Promise<void> {
    const ok = await this.tauxService.remove(id);
    if (!ok) throw new NotFoundException();
  }
}
