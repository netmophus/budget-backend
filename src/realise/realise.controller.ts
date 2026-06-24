/**
 * RealiseController (Lot 5.1) — endpoints REST du module réalisé.
 *
 * Routage :
 *   GET    /realise              (REALISE.LIRE)     listing filtré
 *   GET    /realise/grille       (REALISE.LIRE)     grille CR × mois
 *   GET    /realise/:id          (REALISE.LIRE)     détail
 *   POST   /realise              (REALISE.SAISIR)   saisie manuelle
 *   PATCH  /realise/:id          (REALISE.SAISIR)   modif (statut=IMPORTE)
 *   DELETE /realise/:id          (REALISE.SUPPRIMER) suppression (statut=IMPORTE)
 *   POST   /realise/import       (REALISE.IMPORTER) upload Excel/CSV
 *   GET    /realise/template-xlsx (REALISE.IMPORTER) téléchargement template (Lot 8.5.D)
 *   POST   /realise/valider      (REALISE.VALIDER)  validation en lot
 */
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import {
  CreerFaitRealiseDto,
  FaitRealiseResponseDto,
  ListerFaitsRealiseQueryDto,
  ModifierFaitRealiseDto,
  RapportImportRealiseDto,
  ValiderFaitsRealiseDto,
} from './dto/realise.dto';
import { ParametreSystemeService } from '../parametre-systeme/parametre-systeme.service';
import { RealiseImportService } from './services/realise-import.service';
import { RealiseService } from './services/realise.service';
import { RealiseTemplateService } from './services/realise-template.service';

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

interface UploadedRealiseFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

@ApiTags('realise')
@ApiBearerAuth()
@Controller('realise')
export class RealiseController {
  constructor(
    private readonly svc: RealiseService,
    private readonly importSvc: RealiseImportService,
    private readonly templateSvc: RealiseTemplateService,
    private readonly parametreSvc: ParametreSystemeService,
  ) {}

  @Get()
  @RequirePermissions('REALISE.LIRE')
  @ApiOperation({
    summary:
      'Listing paginé des lignes fait_realise avec filtres (CR, compte, mois, statut, source).',
  })
  @ApiOkResponse()
  lister(
    @Query() q: ListerFaitsRealiseQueryDto,
  ): Promise<{ items: FaitRealiseResponseDto[]; total: number }> {
    return this.svc.lister(q);
  }

  @Get('grille')
  @RequirePermissions('REALISE.LIRE')
  @ApiOperation({
    summary:
      'Grille de consultation/saisie pour un CR sur une plage de mois (YYYY-MM → YYYY-MM).',
  })
  @ApiOkResponse({ type: [FaitRealiseResponseDto] })
  getGrille(
    @Query('crId') crId: string,
    @Query('moisDebut') moisDebut: string,
    @Query('moisFin') moisFin: string,
  ): Promise<FaitRealiseResponseDto[]> {
    if (!crId || !moisDebut || !moisFin) {
      throw new BadRequestException(
        'Paramètres requis : crId, moisDebut, moisFin (format YYYY-MM).',
      );
    }
    return this.svc.getGrille({ crId, moisDebut, moisFin });
  }

  @Get('template-xlsx')
  @RequirePermissions('REALISE.IMPORTER')
  @ApiOperation({
    summary:
      'Téléchargement du template XLSX d’import réalisé (Lot 8.5.D). Workbook 2 onglets (Donnees + Notice), reflète à 100% le format attendu par POST /realise/import.',
  })
  @ApiProduces(
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  )
  @ApiOkResponse({
    description:
      'XLSX binaire (application/vnd.openxmlformats-officedocument.spreadsheetml.sheet), Content-Disposition: attachment ; filename="MIZNAS_Realise_Template.xlsx".',
  })
  async downloadTemplate(@Res() res: Response): Promise<void> {
    const buffer = await this.templateSvc.genererTemplateXlsx();
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="MIZNAS_Realise_Template.xlsx"',
    );
    res.setHeader('Content-Length', String(buffer.length));
    res.send(buffer);
  }

  @Get(':id')
  @RequirePermissions('REALISE.LIRE')
  @ApiOperation({ summary: "Détail d'une ligne fait_realise." })
  @ApiOkResponse({ type: FaitRealiseResponseDto })
  findOne(@Param('id') id: string): Promise<FaitRealiseResponseDto> {
    return this.svc.findOne(id);
  }

  @Post()
  @RequirePermissions('REALISE.SAISIR')
  @ApiOperation({
    summary:
      "Saisie manuelle d'une ligne réalisé. Filtrage périmètre user_perimetres en écriture. Désactivée en mode CENTRALISE (Palier 1).",
  })
  @ApiCreatedResponse({ type: FaitRealiseResponseDto })
  async creer(
    @Body() dto: CreerFaitRealiseDto,
    @CurrentUser() user: AuthUser,
  ): Promise<FaitRealiseResponseDto> {
    // Garde-fou mode CENTRALISE : la saisie manuelle est réservée à
    // l'import (Direction Finance). L'import (POST /import) reste ouvert.
    const mode = await this.parametreSvc.getModeSaisieRealise();
    if (mode === 'CENTRALISE') {
      throw new ForbiddenException(
        'Mode CENTRALISÉ : la saisie manuelle du réalisé est désactivée. ' +
          'Elle est réservée à la Direction Finance via import.',
      );
    }
    return this.svc.creer(dto, user);
  }

  @Patch(':id')
  @RequirePermissions('REALISE.SAISIR')
  @ApiOperation({
    summary:
      'Modification (montant/mode/taux/commentaire) sur une ligne en statut IMPORTE.',
  })
  @ApiOkResponse({ type: FaitRealiseResponseDto })
  modifier(
    @Param('id') id: string,
    @Body() dto: ModifierFaitRealiseDto,
    @CurrentUser() user: AuthUser,
  ): Promise<FaitRealiseResponseDto> {
    return this.svc.modifier(id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions('REALISE.SUPPRIMER')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Suppression hard (statut=IMPORTE uniquement). Filtrage périmètre actif.',
  })
  async supprimer(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<{ supprime: boolean }> {
    await this.svc.supprimer(id, user);
    return { supprime: true };
  }

  @Post('valider')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('REALISE.VALIDER')
  @ApiOperation({
    summary:
      'Validation en lot (IMPORTE → VALIDE). Pas de filtrage périmètre — validateur transverse. Refus si une ligne est déjà VALIDE.',
  })
  @ApiOkResponse()
  valider(
    @Body() dto: ValiderFaitsRealiseDto,
    @CurrentUser() user: AuthUser,
  ): Promise<{ nbValidees: number }> {
    return this.svc.valider(dto.ids, user);
  }

  @Post('import')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('REALISE.IMPORTER')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({
    summary:
      'Import CSV/XLSX de réalisé (6 colonnes obligatoires + 2 optionnelles). Filtrage périmètre appliqué pendant le traitement.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
      required: ['file'],
    },
  })
  @ApiOkResponse({ type: RapportImportRealiseDto })
  async importer(
    @UploadedFile() file: UploadedRealiseFile | undefined,
    @CurrentUser() user: AuthUser,
  ): Promise<RapportImportRealiseDto> {
    if (!file) {
      throw new BadRequestException(
        "Fichier requis (form-data field 'file', formats .csv ou .xlsx).",
      );
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      throw new BadRequestException(
        `Fichier trop volumineux (${(file.size / 1024 / 1024).toFixed(1)} MB). Limite : 10 MB.`,
      );
    }
    return this.importSvc.importFichier(file, user);
  }
}
