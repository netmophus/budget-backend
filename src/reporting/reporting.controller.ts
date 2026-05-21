/**
 * ReportingController (Lot 7.6 — Palier 3) — endpoints HTTP des
 * rapports officiels MIZNAS.
 *
 *   GET /api/v1/reporting/r04-budget-bceao/:versionId.pdf
 *   GET /api/v1/reporting/r04-budget-bceao/:versionId.xlsx
 *
 * Permission : BUDGET.LIRE. Validation statut='gele' faite par
 * `R04BudgetBceaoService.extractDonnees()` (lève 409 sinon, 404 si
 * version inexistante).
 *
 * Audit : chaque export réussi écrit une entrée `audit_log` avec
 * `type_action = EXPORT_R04_PDF | EXPORT_R04_XLSX`. Pas d'audit en
 * cas d'échec (404/409) — l'erreur HTTP standard suffit.
 */
import { Controller, Get, Param, Res } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';

import { AuditService } from '../audit/audit.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { R04BudgetBceaoService } from './services/r04-budget-bceao.service';

/**
 * Date du jour au format YYYYMMDD — préfixe nom de fichier R04.
 */
function todayYyyyMmDd(): string {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

@ApiTags('reporting')
@ApiBearerAuth()
@Controller('reporting')
export class ReportingController {
  constructor(
    private readonly r04Service: R04BudgetBceaoService,
    private readonly auditService: AuditService,
  ) {}

  @Get('r04-budget-bceao/:versionId.pdf')
  @RequirePermissions('BUDGET.LIRE')
  @ApiOperation({
    summary:
      "Rapport R04 'Budget Publié BCEAO' — PDF officiel 12 pages (charte BSIC). Disponible UNIQUEMENT pour les versions au statut 'gele'.",
  })
  @ApiOkResponse({
    description:
      'PDF binaire (application/pdf), Content-Disposition: attachment.',
  })
  @ApiNotFoundResponse({ description: 'versionId inexistant.' })
  @ApiConflictResponse({
    description:
      "Le rapport R4 n'est disponible que pour les versions publiées (gelées).",
  })
  @ApiProduces('application/pdf')
  async downloadR04Pdf(
    @Param('versionId') versionId: string,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
  ): Promise<void> {
    // L'extraction (et validation statut/existence) est faite par le
    // service ; toute exception remonte avant qu'on touche res.
    const donnees = await this.r04Service.extractDonnees(versionId);
    const buffer = await this.r04Service.genererPdfBuffer(versionId);
    const filename = `${donnees.version.code_version}_R04_BCEAO_${todayYyyyMmDd()}.pdf`;

    // Audit POST-réussite — l'export a été produit avec succès.
    await this.auditService.log({
      utilisateur: user.email,
      typeAction: 'EXPORT_R04_PDF',
      entiteCible: 'dim_version',
      idCible: versionId,
      payloadApres: {
        rapport: 'R04',
        format: 'pdf',
        versionId,
        codeVersion: donnees.version.code_version,
        fichier: filename,
        taille_bytes: buffer.length,
      },
      commentaire: `Export R04 (PDF) — fichier : ${filename}`,
      statut: 'success',
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', String(buffer.length));
    res.send(buffer);
  }

  @Get('r04-budget-bceao/:versionId.xlsx')
  @RequirePermissions('BUDGET.LIRE')
  @ApiOperation({
    summary:
      "Rapport R04 'Budget Publié BCEAO' — XLSX exploitable 5 onglets (Synthèse / Compte de résultat / Par CR / Détail comptes / Audit trail). Disponible UNIQUEMENT pour les versions au statut 'gele'.",
  })
  @ApiOkResponse({
    description:
      'XLSX binaire (application/vnd.openxmlformats-officedocument.spreadsheetml.sheet), Content-Disposition: attachment.',
  })
  @ApiNotFoundResponse({ description: 'versionId inexistant.' })
  @ApiConflictResponse({
    description:
      "Le rapport R4 n'est disponible que pour les versions publiées (gelées).",
  })
  @ApiProduces(
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  )
  async downloadR04Xlsx(
    @Param('versionId') versionId: string,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
  ): Promise<void> {
    const donnees = await this.r04Service.extractDonnees(versionId);
    const buffer = await this.r04Service.genererXlsxBuffer(versionId);
    const filename = `${donnees.version.code_version}_R04_BCEAO_${todayYyyyMmDd()}.xlsx`;

    await this.auditService.log({
      utilisateur: user.email,
      typeAction: 'EXPORT_R04_XLSX',
      entiteCible: 'dim_version',
      idCible: versionId,
      payloadApres: {
        rapport: 'R04',
        format: 'xlsx',
        versionId,
        codeVersion: donnees.version.code_version,
        fichier: filename,
        taille_bytes: buffer.length,
      },
      commentaire: `Export R04 (XLSX) — fichier : ${filename}`,
      statut: 'success',
    });

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', String(buffer.length));
    res.send(buffer);
  }
}
