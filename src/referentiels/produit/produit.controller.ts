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
import { CreateProduitDto } from './dto/create-produit.dto';
import { ListProduitsQueryDto } from './dto/list-produits-query.dto';
import { PaginatedProduitsDto } from './dto/paginated-produits.dto';
import { ProduitResponseDto } from './dto/produit-response.dto';
import { UpdateProduitDto } from './dto/update-produit.dto';
import { ProduitService } from './produit.service';

@ApiTags('referentiels-produit')
@ApiBearerAuth()
@Controller('referentiels/produits')
export class ProduitController {
  constructor(private readonly produitService: ProduitService) {}

  // ─── Lecture

  @Get()
  @RequirePermissions('REFERENTIEL.LIRE')
  @ApiOperation({
    summary:
      'Liste paginée des produits (filtres typeProduit, estPorteurInterets, search libellé).',
  })
  @ApiOkResponse({ type: PaginatedProduitsDto })
  findAll(@Query() query: ListProduitsQueryDto): Promise<PaginatedProduitsDto> {
    return this.produitService.findAllPaginated(query);
  }

  @Get('racines')
  @RequirePermissions('REFERENTIEL.LIRE')
  @ApiOperation({ summary: 'Produits racines (niveau 1).' })
  @ApiOkResponse({ type: [ProduitResponseDto] })
  async findRoots(): Promise<ProduitResponseDto[]> {
    const rows = await this.produitService.findRoots();
    return rows.map((r) => this.mapRow(r));
  }

  @Get('par-code/:codeProduit')
  @RequirePermissions('REFERENTIEL.LIRE')
  @ApiOperation({ summary: 'Version courante par code business.' })
  @ApiOkResponse({ type: ProduitResponseDto })
  @ApiNotFoundResponse()
  findByCode(
    @Param('codeProduit') codeProduit: string,
  ): Promise<ProduitResponseDto> {
    return this.produitService.findCurrentByCode(codeProduit);
  }

  @Get('par-code/:codeProduit/historique')
  @RequirePermissions('REFERENTIEL.LIRE')
  @ApiOperation({ summary: 'Historique chronologique du produit.' })
  @ApiOkResponse({ type: [ProduitResponseDto] })
  findHistory(
    @Param('codeProduit') codeProduit: string,
  ): Promise<ProduitResponseDto[]> {
    return this.produitService.findHistoryByCode(codeProduit);
  }

  @Get(':id')
  @RequirePermissions('REFERENTIEL.LIRE')
  @ApiOperation({ summary: 'Produit par surrogate key.' })
  @ApiOkResponse({ type: ProduitResponseDto })
  @ApiNotFoundResponse()
  findOne(@Param('id') id: string): Promise<ProduitResponseDto> {
    return this.produitService.findOneResponse(id);
  }

  @Get(':id/enfants')
  @RequirePermissions('REFERENTIEL.LIRE')
  @ApiOperation({ summary: 'Enfants directs (version courante).' })
  @ApiOkResponse({ type: [ProduitResponseDto] })
  async findChildren(@Param('id') id: string): Promise<ProduitResponseDto[]> {
    const rows = await this.produitService.findChildren(id);
    return rows.map((r) => this.mapRow(r));
  }

  @Get(':id/descendants')
  @RequirePermissions('REFERENTIEL.LIRE')
  @ApiOperation({ summary: 'Descendants récursifs (version courante).' })
  @ApiOkResponse({ type: [ProduitResponseDto] })
  async findDescendants(
    @Param('id') id: string,
  ): Promise<ProduitResponseDto[]> {
    const rows = await this.produitService.findDescendants(id);
    return rows.map((r) => this.mapRow(r));
  }

  @Get(':id/ancetres')
  @RequirePermissions('REFERENTIEL.LIRE')
  @ApiOperation({ summary: "Ancêtres jusqu'à la racine (version courante)." })
  @ApiOkResponse({ type: [ProduitResponseDto] })
  async findAncestors(
    @Param('id') id: string,
  ): Promise<ProduitResponseDto[]> {
    const rows = await this.produitService.findAncestors(id);
    return rows.map((r) => this.mapRow(r));
  }

  // ─── Mutation

  @Post()
  @RequirePermissions('REFERENTIEL.GERER')
  @Auditable({ typeAction: 'CREATE', entiteCible: 'dim_produit' })
  @ApiOperation({ summary: 'Crée un nouveau produit (REFERENTIEL.GERER).' })
  @ApiCreatedResponse({ type: ProduitResponseDto })
  @ApiConflictResponse({ description: 'codeProduit déjà existant.' })
  @ApiUnprocessableEntityResponse({
    description: 'Parent inexistant, niveau incohérent ou cycle.',
  })
  @ApiBadRequestResponse({ description: 'Validation DTO invalide.' })
  create(
    @Body() dto: CreateProduitDto,
    @CurrentUser() user: AuthUser,
  ): Promise<ProduitResponseDto> {
    return this.produitService.create(dto, user.email);
  }

  @Patch('par-code/:codeProduit')
  @RequirePermissions('REFERENTIEL.GERER')
  @Auditable({
    typeAction: 'UPDATE',
    entiteCible: 'dim_produit',
    extractIdCible: (req) =>
      (req.params as { codeProduit?: string }).codeProduit ?? null,
  })
  @ApiOperation({
    summary:
      'Modifie un produit (sémantique 4-cas, relink auto-référence stratégie A).',
  })
  @ApiOkResponse({ type: ProduitResponseDto })
  @ApiNotFoundResponse()
  @ApiUnprocessableEntityResponse()
  update(
    @Param('codeProduit') codeProduit: string,
    @Body() dto: UpdateProduitDto,
    @CurrentUser() user: AuthUser,
  ): Promise<ProduitResponseDto> {
    return this.produitService.update(codeProduit, dto, user.email);
  }

  @Delete('par-code/:codeProduit')
  @RequirePermissions('REFERENTIEL.GERER')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Auditable({
    typeAction: 'DELETE',
    entiteCible: 'dim_produit',
    extractIdCible: (req) =>
      (req.params as { codeProduit?: string }).codeProduit ?? null,
  })
  @ApiOperation({
    summary:
      'Désactive (soft-close) la version courante. Refuse si le produit a des enfants courants.',
  })
  @ApiNoContentResponse()
  @ApiNotFoundResponse()
  @ApiConflictResponse({
    description: "Le produit a des enfants courants — fermer/transférer d'abord.",
  })
  async desactiver(
    @Param('codeProduit') codeProduit: string,
    @CurrentUser() user: AuthUser,
  ): Promise<void> {
    await this.produitService.desactiver(codeProduit, user.email);
  }

  // ─── helpers

  private mapRow(
    r: import('./entities/dim-produit.entity').DimProduit,
  ): ProduitResponseDto {
    return {
      id: r.id,
      codeProduit: r.codeProduit,
      libelle: r.libelle,
      typeProduit: r.typeProduit,
      fkProduitParent: r.fkProduitParent,
      niveau: r.niveau,
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
