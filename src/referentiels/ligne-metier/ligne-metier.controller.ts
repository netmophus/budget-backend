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
import { CreateLigneMetierDto } from './dto/create-ligne-metier.dto';
import { LigneMetierResponseDto } from './dto/ligne-metier-response.dto';
import { ListLignesMetierQueryDto } from './dto/list-lignes-metier-query.dto';
import { PaginatedLignesMetierDto } from './dto/paginated-lignes-metier.dto';
import { UpdateLigneMetierDto } from './dto/update-ligne-metier.dto';
import { LigneMetierService } from './ligne-metier.service';

@ApiTags('referentiels-ligne-metier')
@ApiBearerAuth()
@Controller('referentiels/lignes-metier')
export class LigneMetierController {
  constructor(private readonly ligneMetierService: LigneMetierService) {}

  // ─── Lecture

  @Get()
  @RequirePermissions('REFERENTIEL.LIRE')
  @ApiOperation({
    summary: 'Liste paginée des lignes métier (filtre search libellé).',
  })
  @ApiOkResponse({ type: PaginatedLignesMetierDto })
  findAll(
    @Query() query: ListLignesMetierQueryDto,
  ): Promise<PaginatedLignesMetierDto> {
    return this.ligneMetierService.findAllPaginated(query);
  }

  @Get('racines')
  @RequirePermissions('REFERENTIEL.LIRE')
  @ApiOperation({
    summary: 'Lignes métier racines (niveau 1, sans parent).',
  })
  @ApiOkResponse({ type: [LigneMetierResponseDto] })
  async findRoots(): Promise<LigneMetierResponseDto[]> {
    const rows = await this.ligneMetierService.findRoots();
    return rows.map((r) => this.mapRow(r));
  }

  @Get('par-code/:codeLigneMetier')
  @RequirePermissions('REFERENTIEL.LIRE')
  @ApiOperation({ summary: 'Version courante par code business.' })
  @ApiOkResponse({ type: LigneMetierResponseDto })
  @ApiNotFoundResponse()
  findByCode(
    @Param('codeLigneMetier') codeLigneMetier: string,
  ): Promise<LigneMetierResponseDto> {
    return this.ligneMetierService.findCurrentByCode(codeLigneMetier);
  }

  @Get('par-code/:codeLigneMetier/historique')
  @RequirePermissions('REFERENTIEL.LIRE')
  @ApiOperation({ summary: 'Historique chronologique de la ligne métier.' })
  @ApiOkResponse({ type: [LigneMetierResponseDto] })
  findHistory(
    @Param('codeLigneMetier') codeLigneMetier: string,
  ): Promise<LigneMetierResponseDto[]> {
    return this.ligneMetierService.findHistoryByCode(codeLigneMetier);
  }

  @Get(':id')
  @RequirePermissions('REFERENTIEL.LIRE')
  @ApiOperation({ summary: 'Ligne métier par surrogate key.' })
  @ApiOkResponse({ type: LigneMetierResponseDto })
  @ApiNotFoundResponse()
  findOne(@Param('id') id: string): Promise<LigneMetierResponseDto> {
    return this.ligneMetierService.findOneResponse(id);
  }

  @Get(':id/enfants')
  @RequirePermissions('REFERENTIEL.LIRE')
  @ApiOperation({ summary: 'Enfants directs (version courante).' })
  @ApiOkResponse({ type: [LigneMetierResponseDto] })
  async findChildren(
    @Param('id') id: string,
  ): Promise<LigneMetierResponseDto[]> {
    const rows = await this.ligneMetierService.findChildren(id);
    return rows.map((r) => this.mapRow(r));
  }

  @Get(':id/descendants')
  @RequirePermissions('REFERENTIEL.LIRE')
  @ApiOperation({ summary: 'Descendants récursifs (version courante).' })
  @ApiOkResponse({ type: [LigneMetierResponseDto] })
  async findDescendants(
    @Param('id') id: string,
  ): Promise<LigneMetierResponseDto[]> {
    const rows = await this.ligneMetierService.findDescendants(id);
    return rows.map((r) => this.mapRow(r));
  }

  @Get(':id/ancetres')
  @RequirePermissions('REFERENTIEL.LIRE')
  @ApiOperation({ summary: "Ancêtres jusqu'à la racine (version courante)." })
  @ApiOkResponse({ type: [LigneMetierResponseDto] })
  async findAncestors(
    @Param('id') id: string,
  ): Promise<LigneMetierResponseDto[]> {
    const rows = await this.ligneMetierService.findAncestors(id);
    return rows.map((r) => this.mapRow(r));
  }

  // ─── Mutation

  @Post()
  @RequirePermissions('REFERENTIEL.GERER')
  @Auditable({ typeAction: 'CREATE', entiteCible: 'dim_ligne_metier' })
  @ApiOperation({ summary: 'Crée une nouvelle ligne métier (REFERENTIEL.GERER).' })
  @ApiCreatedResponse({ type: LigneMetierResponseDto })
  @ApiConflictResponse({ description: 'codeLigneMetier déjà existant.' })
  @ApiUnprocessableEntityResponse({
    description: 'Parent inexistant, niveau incohérent ou cycle.',
  })
  @ApiBadRequestResponse({ description: 'Validation DTO invalide.' })
  create(
    @Body() dto: CreateLigneMetierDto,
    @CurrentUser() user: AuthUser,
  ): Promise<LigneMetierResponseDto> {
    return this.ligneMetierService.create(dto, user.email);
  }

  @Patch('par-code/:codeLigneMetier')
  @RequirePermissions('REFERENTIEL.GERER')
  @Auditable({
    typeAction: 'UPDATE',
    entiteCible: 'dim_ligne_metier',
    extractIdCible: (req) =>
      (req.params as { codeLigneMetier?: string }).codeLigneMetier ?? null,
  })
  @ApiOperation({
    summary:
      'Modifie une ligne métier (sémantique 4-cas, relink auto-référence stratégie A).',
  })
  @ApiOkResponse({ type: LigneMetierResponseDto })
  @ApiNotFoundResponse()
  @ApiUnprocessableEntityResponse()
  update(
    @Param('codeLigneMetier') codeLigneMetier: string,
    @Body() dto: UpdateLigneMetierDto,
    @CurrentUser() user: AuthUser,
  ): Promise<LigneMetierResponseDto> {
    return this.ligneMetierService.update(codeLigneMetier, dto, user.email);
  }

  @Delete('par-code/:codeLigneMetier')
  @RequirePermissions('REFERENTIEL.GERER')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Auditable({
    typeAction: 'DELETE',
    entiteCible: 'dim_ligne_metier',
    extractIdCible: (req) =>
      (req.params as { codeLigneMetier?: string }).codeLigneMetier ?? null,
  })
  @ApiOperation({
    summary:
      'Désactive (soft-close) la version courante. Refuse si la ligne métier a des enfants courants.',
  })
  @ApiNoContentResponse()
  @ApiNotFoundResponse()
  @ApiConflictResponse({
    description:
      "La ligne métier a des enfants courants — fermer/transférer d'abord.",
  })
  async desactiver(
    @Param('codeLigneMetier') codeLigneMetier: string,
    @CurrentUser() user: AuthUser,
  ): Promise<void> {
    await this.ligneMetierService.desactiver(codeLigneMetier, user.email);
  }

  // ─── helpers

  private mapRow(
    r: import('./entities/dim-ligne-metier.entity').DimLigneMetier,
  ): LigneMetierResponseDto {
    return {
      id: r.id,
      codeLigneMetier: r.codeLigneMetier,
      libelle: r.libelle,
      fkLigneMetierParent: r.fkLigneMetierParent,
      niveau: r.niveau,
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
