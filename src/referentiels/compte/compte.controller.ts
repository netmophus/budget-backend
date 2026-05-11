import {
  BadRequestException,
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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
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
import { CompteImportService } from './compte-import.service';
import { CompteService } from './compte.service';
import { CompteResponseDto } from './dto/compte-response.dto';
import { CreateCompteDto } from './dto/create-compte.dto';
import { ImportRapportDto } from './dto/import-rapport.dto';
import type { ImportMode } from './dto/import-request.dto';
import { ListComptesQueryDto } from './dto/list-comptes-query.dto';
import { PaginatedComptesDto } from './dto/paginated-comptes.dto';
import { UpdateCompteDto } from './dto/update-compte.dto';

/**
 * Type local minimal pour le fichier uploadé (multer). On évite
 * d'ajouter `@types/multer` comme dépendance — seuls les champs
 * effectivement consommés sont déclarés.
 */
interface UploadedCsvFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

@ApiTags('referentiels-compte')
@ApiBearerAuth()
@Controller('referentiels/comptes')
export class CompteController {
  constructor(
    private readonly compteService: CompteService,
    private readonly compteImportService: CompteImportService,
  ) {}

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
  async findDescendants(@Param('id') id: string): Promise<CompteResponseDto[]> {
    const rows = await this.compteService.findDescendants(id);
    return rows.map((r) => this.mapRow(r));
  }

  @Get(':id/ancetres')
  @RequirePermissions('REFERENTIEL.LIRE')
  @ApiOperation({ summary: "Ancêtres jusqu'à la racine (version courante)." })
  @ApiOkResponse({ type: [CompteResponseDto] })
  async findAncestors(@Param('id') id: string): Promise<CompteResponseDto[]> {
    const rows = await this.compteService.findAncestors(id);
    return rows.map((r) => this.mapRow(r));
  }

  // ─── Mutation

  @Post('import')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('REFERENTIEL.GERER')
  @UseInterceptors(FileInterceptor('file'))
  @Auditable({ typeAction: 'IMPORT', entiteCible: 'dim_compte' })
  @ApiOperation({
    summary:
      'Import en masse du PCB UMOA révisé depuis un fichier CSV (multipart/form-data, field "file"). Premier vrai usage de CsvImportService (socle 2.1).',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        mode: {
          type: 'string',
          enum: ['insert-only', 'upsert'],
          default: 'insert-only',
        },
      },
      required: ['file'],
    },
  })
  @ApiOkResponse({ type: ImportRapportDto })
  @ApiBadRequestResponse({ description: 'Fichier manquant ou invalide.' })
  async importCsv(
    @UploadedFile() file: UploadedCsvFile | undefined,
    @Query('mode') mode: ImportMode = 'insert-only',
    @CurrentUser() user: AuthUser,
  ): Promise<ImportRapportDto> {
    if (!file) {
      throw new BadRequestException(
        "Fichier CSV requis (form-data field 'file').",
      );
    }
    // Valider grossièrement l'extension / mimetype pour rejeter
    // immédiatement les uploads PDF / xlsx — le parsing CSV ferait
    // de toute façon échouer chaque ligne, mais autant donner un
    // message clair côté API.
    const isCsv =
      file.mimetype.includes('csv') ||
      file.mimetype === 'text/plain' ||
      file.originalname.toLowerCase().endsWith('.csv');
    if (!isCsv) {
      throw new BadRequestException(
        `Type de fichier non supporté (mimetype=${file.mimetype}, nom=${file.originalname}). Attendu : .csv`,
      );
    }
    return this.compteImportService.importBuffer(file.buffer, mode, user.email);
  }

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
    description:
      "Le compte a des enfants courants — fermer/transférer d'abord.",
  })
  async desactiver(
    @Param('codeCompte') codeCompte: string,
    @CurrentUser() user: AuthUser,
  ): Promise<void> {
    await this.compteService.desactiver(codeCompte, user.email);
  }

  // ─── helpers

  private mapRow(
    r: import('./entities/dim-compte.entity').DimCompte,
  ): CompteResponseDto {
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
