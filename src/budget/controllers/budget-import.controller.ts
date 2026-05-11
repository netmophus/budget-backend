/**
 * BudgetImportController (Lot 3.7) — endpoint multipart/form-data
 * pour l'import en masse de saisie budgétaire (CSV ou XLSX).
 *
 * Permission : `BUDGET.SAISIR`. La transaction et l'audit sont
 * pilotés par BudgetImportService — le controller se contente de
 * valider la présence du fichier et la borne de taille (10 MB).
 */
import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
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
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthUser } from '../../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator';
import {
  ImportBudgetRapportDto,
  ImportBudgetRequestDto,
} from '../dto/import-budget.dto';
import { BudgetImportService } from '../services/budget-import.service';

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

interface UploadedBudgetFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

@ApiTags('budget-import')
@ApiBearerAuth()
@Controller('budget/import')
export class BudgetImportController {
  constructor(private readonly importService: BudgetImportService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('BUDGET.SAISIR')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({
    summary:
      "Import en masse d'un fichier CSV/XLSX de saisie budgétaire " +
      '(9 colonnes fixes — cf. import-budget.dto.ts). Filtrage périmètre Q5 ' +
      "actif, rollback global si > 10 % d'erreurs.",
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        versionId: { type: 'string' },
        scenarioId: { type: 'string' },
      },
      required: ['file', 'versionId', 'scenarioId'],
    },
  })
  @ApiOkResponse({ type: ImportBudgetRapportDto })
  @ApiBadRequestResponse({
    description:
      'Fichier manquant, format non supporté, header invalide, ou fichier vide.',
  })
  @ApiConflictResponse({
    description: "Version statut différent de 'ouvert' (Brouillon).",
  })
  async importBudget(
    @UploadedFile() file: UploadedBudgetFile | undefined,
    @Body() body: ImportBudgetRequestDto,
    @CurrentUser() user: AuthUser,
  ): Promise<ImportBudgetRapportDto> {
    if (!file) {
      throw new BadRequestException(
        "Fichier requis (form-data field 'file', formats .csv ou .xlsx).",
      );
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      throw new BadRequestException(
        `Fichier trop volumineux (${(file.size / 1024 / 1024).toFixed(1)} MB). ` +
          `Limite : 10 MB.`,
      );
    }
    return this.importService.importFichier(
      file,
      body.versionId,
      body.scenarioId,
      user,
    );
  }
}
