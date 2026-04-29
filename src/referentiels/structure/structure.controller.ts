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
import { CreateStructureDto } from './dto/create-structure.dto';
import { ListStructuresQueryDto } from './dto/list-structures-query.dto';
import { PaginatedStructuresDto } from './dto/paginated-structures.dto';
import { StructureResponseDto } from './dto/structure-response.dto';
import { UpdateStructureDto } from './dto/update-structure.dto';
import { StructureService } from './structure.service';

@ApiTags('referentiels-structure')
@ApiBearerAuth()
@Controller('referentiels/structures')
export class StructureController {
  constructor(private readonly structureService: StructureService) {}

  // ─── Lecture ──────────────────────────────────────────────────────

  @Get()
  @RequirePermissions('REFERENTIEL.LIRE')
  @ApiOperation({
    summary: 'Liste paginée (filtres codePays, typeStructure, search, versionCouranteUniquement).',
  })
  @ApiOkResponse({ type: PaginatedStructuresDto })
  findAll(
    @Query() query: ListStructuresQueryDto,
  ): Promise<PaginatedStructuresDto> {
    return this.structureService.findAllPaginated(query);
  }

  @Get('racines')
  @RequirePermissions('REFERENTIEL.LIRE')
  @ApiOperation({ summary: 'Structures racines (sans parent — entités juridiques).' })
  @ApiOkResponse({ type: [StructureResponseDto] })
  async findRoots(): Promise<StructureResponseDto[]> {
    const rows = await this.structureService.findRoots();
    return rows.map((r) => ({
      id: r.id,
      codeStructure: r.codeStructure,
      libelle: r.libelle,
      libelleCourt: r.libelleCourt,
      typeStructure: r.typeStructure,
      niveauHierarchique: r.niveauHierarchique,
      fkStructureParent: r.fkStructureParent,
      codePays: r.codePays,
      dateDebutValidite: r.dateDebutValidite,
      dateFinValidite: r.dateFinValidite,
      versionCourante: r.versionCourante,
      estActif: r.estActif,
      dateCreation: r.dateCreation,
      utilisateurCreation: r.utilisateurCreation,
      dateModification: r.dateModification,
      utilisateurModification: r.utilisateurModification,
    }));
  }

  @Get('par-code/:codeStructure')
  @RequirePermissions('REFERENTIEL.LIRE')
  @ApiOperation({ summary: 'Version courante par business key (code_structure).' })
  @ApiOkResponse({ type: StructureResponseDto })
  @ApiNotFoundResponse()
  findByCode(
    @Param('codeStructure') codeStructure: string,
  ): Promise<StructureResponseDto> {
    return this.structureService.findCurrentByCode(codeStructure);
  }

  @Get('par-code/:codeStructure/historique')
  @RequirePermissions('REFERENTIEL.LIRE')
  @ApiOperation({ summary: "Historique chronologique d'une structure (toutes versions SCD2)." })
  @ApiOkResponse({ type: [StructureResponseDto] })
  findHistory(
    @Param('codeStructure') codeStructure: string,
  ): Promise<StructureResponseDto[]> {
    return this.structureService.findHistoryByCode(codeStructure);
  }

  @Get(':id')
  @RequirePermissions('REFERENTIEL.LIRE')
  @ApiOperation({ summary: 'Récupère une structure par son surrogate key.' })
  @ApiOkResponse({ type: StructureResponseDto })
  @ApiNotFoundResponse()
  findOne(@Param('id') id: string): Promise<StructureResponseDto> {
    return this.structureService.findOneResponse(id);
  }

  @Get(':id/enfants')
  @RequirePermissions('REFERENTIEL.LIRE')
  @ApiOperation({ summary: 'Enfants directs (version courante uniquement).' })
  @ApiOkResponse({ type: [StructureResponseDto] })
  async findChildren(@Param('id') id: string): Promise<StructureResponseDto[]> {
    const rows = await this.structureService.findChildren(id);
    return rows.map((r) => ({
      id: r.id,
      codeStructure: r.codeStructure,
      libelle: r.libelle,
      libelleCourt: r.libelleCourt,
      typeStructure: r.typeStructure,
      niveauHierarchique: r.niveauHierarchique,
      fkStructureParent: r.fkStructureParent,
      codePays: r.codePays,
      dateDebutValidite: r.dateDebutValidite,
      dateFinValidite: r.dateFinValidite,
      versionCourante: r.versionCourante,
      estActif: r.estActif,
      dateCreation: r.dateCreation,
      utilisateurCreation: r.utilisateurCreation,
      dateModification: r.dateModification,
      utilisateurModification: r.utilisateurModification,
    }));
  }

  @Get(':id/descendants')
  @RequirePermissions('REFERENTIEL.LIRE')
  @ApiOperation({ summary: 'Descendants récursifs (version courante uniquement).' })
  @ApiOkResponse({ type: [StructureResponseDto] })
  async findDescendants(
    @Param('id') id: string,
  ): Promise<StructureResponseDto[]> {
    const rows = await this.structureService.findDescendants(id);
    return rows.map((r) => ({
      id: r.id,
      codeStructure: r.codeStructure,
      libelle: r.libelle,
      libelleCourt: r.libelleCourt,
      typeStructure: r.typeStructure,
      niveauHierarchique: r.niveauHierarchique,
      fkStructureParent: r.fkStructureParent,
      codePays: r.codePays,
      dateDebutValidite: r.dateDebutValidite,
      dateFinValidite: r.dateFinValidite,
      versionCourante: r.versionCourante,
      estActif: r.estActif,
      dateCreation: r.dateCreation,
      utilisateurCreation: r.utilisateurCreation,
      dateModification: r.dateModification,
      utilisateurModification: r.utilisateurModification,
    }));
  }

  @Get(':id/ancetres')
  @RequirePermissions('REFERENTIEL.LIRE')
  @ApiOperation({ summary: "Ancêtres de la structure (jusqu'à la racine, version courante)." })
  @ApiOkResponse({ type: [StructureResponseDto] })
  async findAncestors(
    @Param('id') id: string,
  ): Promise<StructureResponseDto[]> {
    const rows = await this.structureService.findAncestors(id);
    return rows.map((r) => ({
      id: r.id,
      codeStructure: r.codeStructure,
      libelle: r.libelle,
      libelleCourt: r.libelleCourt,
      typeStructure: r.typeStructure,
      niveauHierarchique: r.niveauHierarchique,
      fkStructureParent: r.fkStructureParent,
      codePays: r.codePays,
      dateDebutValidite: r.dateDebutValidite,
      dateFinValidite: r.dateFinValidite,
      versionCourante: r.versionCourante,
      estActif: r.estActif,
      dateCreation: r.dateCreation,
      utilisateurCreation: r.utilisateurCreation,
      dateModification: r.dateModification,
      utilisateurModification: r.utilisateurModification,
    }));
  }

  // ─── Mutation ─────────────────────────────────────────────────────

  @Post()
  @RequirePermissions('REFERENTIEL.GERER')
  @Auditable({ typeAction: 'CREATE', entiteCible: 'dim_structure' })
  @ApiOperation({
    summary: 'Crée une nouvelle structure (1ʳᵉ version SCD2 — REFERENTIEL.GERER).',
  })
  @ApiCreatedResponse({ type: StructureResponseDto })
  @ApiConflictResponse({ description: 'codeStructure déjà existant en version courante.' })
  @ApiUnprocessableEntityResponse({
    description: 'Parent inexistant, type/niveau incohérent ou cycle.',
  })
  @ApiBadRequestResponse({ description: 'Validation DTO invalide.' })
  create(
    @Body() dto: CreateStructureDto,
    @CurrentUser() user: AuthUser,
  ): Promise<StructureResponseDto> {
    return this.structureService.create(dto, user.email);
  }

  @Patch('par-code/:codeStructure')
  @RequirePermissions('REFERENTIEL.GERER')
  @Auditable({
    typeAction: 'UPDATE',
    entiteCible: 'dim_structure',
    extractIdCible: (req) =>
      (req.params as { codeStructure?: string }).codeStructure ?? null,
  })
  @ApiOperation({
    summary:
      'Modifie une structure : nouvelle version SCD2 si champs tracés modifiés, mise à jour en place si seul estActif change.',
  })
  @ApiOkResponse({ type: StructureResponseDto })
  @ApiNotFoundResponse()
  @ApiUnprocessableEntityResponse({
    description: 'Cycle, type/niveau incohérent ou parent inexistant.',
  })
  update(
    @Param('codeStructure') codeStructure: string,
    @Body() dto: UpdateStructureDto,
    @CurrentUser() user: AuthUser,
  ): Promise<StructureResponseDto> {
    return this.structureService.update(codeStructure, dto, user.email);
  }

  @Delete('par-code/:codeStructure')
  @RequirePermissions('REFERENTIEL.GERER')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Auditable({
    typeAction: 'DELETE',
    entiteCible: 'dim_structure',
    extractIdCible: (req) =>
      (req.params as { codeStructure?: string }).codeStructure ?? null,
  })
  @ApiOperation({
    summary:
      'Désactive (soft-close) la version courante. Aucune nouvelle version créée. Refus si la structure a des enfants courants.',
  })
  @ApiNoContentResponse()
  @ApiNotFoundResponse()
  @ApiConflictResponse({
    description: 'La structure a des enfants courants — fermer/transférer les enfants d\'abord.',
  })
  async desactiver(
    @Param('codeStructure') codeStructure: string,
    @CurrentUser() user: AuthUser,
  ): Promise<void> {
    await this.structureService.desactiver(codeStructure, user.email);
  }
}
