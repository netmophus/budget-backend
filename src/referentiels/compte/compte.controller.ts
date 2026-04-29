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
import { CompteService } from './compte.service';
import { CompteResponseDto } from './dto/compte-response.dto';
import { CreateCompteDto } from './dto/create-compte.dto';
import { ListComptesQueryDto } from './dto/list-comptes-query.dto';
import { PaginatedComptesDto } from './dto/paginated-comptes.dto';
import { UpdateCompteDto } from './dto/update-compte.dto';

@ApiTags('referentiels-compte')
@ApiBearerAuth()
@Controller('referentiels/comptes')
export class CompteController {
  constructor(private readonly compteService: CompteService) {}

  // ─── Lecture

  @Get()
  @RequirePermissions('REFERENTIEL.LIRE')
  @ApiOperation({
    summary:
      'Liste paginée des comptes (filtres classe, search, codePosteBudgetaire, estCompteCollectif, estPorteurInterets).',
  })
  @ApiOkResponse({ type: PaginatedComptesDto })
  findAll(@Query() query: ListComptesQueryDto): Promise<PaginatedComptesDto> {
    return this.compteService.findAllPaginated(query);
  }

  @Get('racines')
  @RequirePermissions('REFERENTIEL.LIRE')
  @ApiOperation({ summary: 'Comptes racines (les classes du PCB).' })
  @ApiOkResponse({ type: [CompteResponseDto] })
  async findRoots(): Promise<CompteResponseDto[]> {
    const rows = await this.compteService.findRoots();
    return rows.map((r) => this.mapRow(r));
  }

  @Get('par-code/:codeCompte')
  @RequirePermissions('REFERENTIEL.LIRE')
  @ApiOperation({ summary: 'Version courante par code business.' })
  @ApiOkResponse({ type: CompteResponseDto })
  @ApiNotFoundResponse()
  findByCode(
    @Param('codeCompte') codeCompte: string,
  ): Promise<CompteResponseDto> {
    return this.compteService.findCurrentByCode(codeCompte);
  }

  @Get('par-code/:codeCompte/historique')
  @RequirePermissions('REFERENTIEL.LIRE')
  @ApiOperation({ summary: 'Historique chronologique du compte.' })
  @ApiOkResponse({ type: [CompteResponseDto] })
  findHistory(
    @Param('codeCompte') codeCompte: string,
  ): Promise<CompteResponseDto[]> {
    return this.compteService.findHistoryByCode(codeCompte);
  }

  @Get(':id')
  @RequirePermissions('REFERENTIEL.LIRE')
  @ApiOperation({ summary: 'Compte par surrogate key.' })
  @ApiOkResponse({ type: CompteResponseDto })
  @ApiNotFoundResponse()
  findOne(@Param('id') id: string): Promise<CompteResponseDto> {
    return this.compteService.findOneResponse(id);
  }

  @Get(':id/enfants')
  @RequirePermissions('REFERENTIEL.LIRE')
  @ApiOperation({ summary: 'Enfants directs (version courante).' })
  @ApiOkResponse({ type: [CompteResponseDto] })
  async findChildren(@Param('id') id: string): Promise<CompteResponseDto[]> {
    const rows = await this.compteService.findChildren(id);
    return rows.map((r) => this.mapRow(r));
  }

  @Get(':id/descendants')
  @RequirePermissions('REFERENTIEL.LIRE')
  @ApiOperation({ summary: 'Descendants récursifs (version courante).' })
  @ApiOkResponse({ type: [CompteResponseDto] })
  async findDescendants(
    @Param('id') id: string,
  ): Promise<CompteResponseDto[]> {
    const rows = await this.compteService.findDescendants(id);
    return rows.map((r) => this.mapRow(r));
  }

  @Get(':id/ancetres')
  @RequirePermissions('REFERENTIEL.LIRE')
  @ApiOperation({ summary: "Ancêtres jusqu'à la racine (version courante)." })
  @ApiOkResponse({ type: [CompteResponseDto] })
  async findAncestors(
    @Param('id') id: string,
  ): Promise<CompteResponseDto[]> {
    const rows = await this.compteService.findAncestors(id);
    return rows.map((r) => this.mapRow(r));
  }

  // ─── Mutation

  @Post()
  @RequirePermissions('REFERENTIEL.GERER')
  @Auditable({ typeAction: 'CREATE', entiteCible: 'dim_compte' })
  @ApiOperation({ summary: 'Crée un nouveau compte (REFERENTIEL.GERER).' })
  @ApiCreatedResponse({ type: CompteResponseDto })
  @ApiConflictResponse({ description: 'codeCompte déjà existant.' })
  @ApiUnprocessableEntityResponse({
    description:
      'Parent inexistant, niveau/classe incohérents, cycle, ou ni fkCompteParent ni codeCompteParent.',
  })
  @ApiBadRequestResponse({ description: 'Validation DTO invalide.' })
  create(
    @Body() dto: CreateCompteDto,
    @CurrentUser() user: AuthUser,
  ): Promise<CompteResponseDto> {
    return this.compteService.create(dto, user.email);
  }

  @Patch('par-code/:codeCompte')
  @RequirePermissions('REFERENTIEL.GERER')
  @Auditable({
    typeAction: 'UPDATE',
    entiteCible: 'dim_compte',
    extractIdCible: (req) =>
      (req.params as { codeCompte?: string }).codeCompte ?? null,
  })
  @ApiOperation({
    summary:
      'Modifie un compte (sémantique 4-cas, relink auto-référence stratégie A).',
  })
  @ApiOkResponse({ type: CompteResponseDto })
  @ApiNotFoundResponse()
  @ApiUnprocessableEntityResponse()
  update(
    @Param('codeCompte') codeCompte: string,
    @Body() dto: UpdateCompteDto,
    @CurrentUser() user: AuthUser,
  ): Promise<CompteResponseDto> {
    return this.compteService.update(codeCompte, dto, user.email);
  }

  @Delete('par-code/:codeCompte')
  @RequirePermissions('REFERENTIEL.GERER')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Auditable({
    typeAction: 'DELETE',
    entiteCible: 'dim_compte',
    extractIdCible: (req) =>
      (req.params as { codeCompte?: string }).codeCompte ?? null,
  })
  @ApiOperation({
    summary:
      'Désactive (soft-close) la version courante. Refuse si le compte a des enfants courants.',
  })
  @ApiNoContentResponse()
  @ApiNotFoundResponse()
  @ApiConflictResponse({
    description: 'Le compte a des enfants courants — fermer/transférer d\'abord.',
  })
  async desactiver(
    @Param('codeCompte') codeCompte: string,
    @CurrentUser() user: AuthUser,
  ): Promise<void> {
    await this.compteService.desactiver(codeCompte, user.email);
  }

  // ─── helpers

  private mapRow(r: import('./entities/dim-compte.entity').DimCompte): CompteResponseDto {
    return {
      id: r.id,
      codeCompte: r.codeCompte,
      libelle: r.libelle,
      classe: r.classe,
      sousClasse: r.sousClasse,
      fkCompteParent: r.fkCompteParent,
      niveau: r.niveau,
      sens: r.sens,
      codePosteBudgetaire: r.codePosteBudgetaire,
      estCompteCollectif: r.estCompteCollectif,
      estPorteurInterets: r.estPorteurInterets,
      dateDebutValidite: r.dateDebutValidite,
      dateFinValidite: r.dateFinValidite,
      versionCourante: r.versionCourante,
      estActif: r.estActif,
      dateCreation: r.dateCreation,
      utilisateurCreation: r.utilisateurCreation,
      dateModification: r.dateModification,
      utilisateurModification: r.utilisateurModification,
    };
  }
}
