/**
 * AnalyseIaPdfController (Chantier C-fix) — export PDF d'une analyse IA
 * HISTORISÉE, par id. Placé dans le module tableau-de-bord (qui dépend déjà
 * d'analyse-ia) pour éviter un cycle de modules.
 *
 *   GET /analyses-ia/:id/pdf  (gate AI.ANALYSER + contrôle d'accès getPourExport)
 *
 * - Dataset figé présent → PDF FIDÈLE reconstruit depuis le snapshot.
 * - Sinon (analyse C1 antérieure) → repli : recalcul via getBudgetVsRealise.
 */
import { Controller, Get, Logger, Param, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { AnalyseIaService } from '../analyse-ia/analyse-ia.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { AuditService } from '../audit/audit.service';
import { EcartsResponseDto } from './dto/tableau-bord.dto';
import { AnalyseEcartsService } from './services/analyse-ecarts.service';
import { ExportPdfService } from './services/export-pdf.service';

@ApiTags('analyses-ia')
@ApiBearerAuth()
@Controller('analyses-ia')
export class AnalyseIaPdfController {
  private readonly logger = new Logger(AnalyseIaPdfController.name);

  constructor(
    private readonly analyseIaSvc: AnalyseIaService,
    private readonly analyseSvc: AnalyseEcartsService,
    private readonly exportPdfSvc: ExportPdfService,
    private readonly auditSvc: AuditService,
  ) {}

  @Get(':id/pdf')
  @RequirePermissions('AI.ANALYSER')
  @ApiOperation({
    summary:
      "Export PDF d'une analyse IA historisée. Dataset figé -> PDF fidèle (document d'archive) ; sinon repli sur recalcul. Accès : propriétaire OU AI.HISTORIQUE. Chantier C-fix.",
  })
  async exportPdf(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
  ): Promise<void> {
    // Charge l'entité (avec datasetSnapshot) + contrôle d'accès.
    const a = await this.analyseIaSvc.getPourExport(id, user);

    const analyseIa = {
      analyse: a.reponseMarkdown,
      model: a.modele,
      tokensInput: a.tokensIn,
      tokensOutput: a.tokensOut,
      dureeMs: a.dureeMs,
      dryRun: a.dryRun,
      generatedAt: a.dateGeneration.toISOString(),
    };

    let ecarts: EcartsResponseDto;
    let codeVersion: string;
    let codeScenario: string;
    let recalcule: boolean;

    if (a.datasetSnapshot) {
      // Document d'archive fidèle : on rejoue le dataset figé.
      ecarts = a.datasetSnapshot.ecarts as unknown as EcartsResponseDto;
      codeVersion = a.datasetSnapshot.codeVersion;
      codeScenario = a.datasetSnapshot.codeScenario;
      recalcule = false;
    } else {
      // Rétrocompat (analyse C1 sans dataset) : recalcul des écarts.
      ecarts = await this.analyseSvc.getBudgetVsRealise(
        {
          versionId: a.versionId,
          scenarioId: a.scenarioId,
          moisDebut: a.moisDebut,
          moisFin: a.moisFin,
          crIds: a.crsSelectionnes ?? undefined,
        },
        user,
      );
      codeVersion = a.versionId;
      codeScenario = a.scenarioId;
      recalcule = true;
    }

    const buffer = await this.exportPdfSvc.genererPdf(
      ecarts,
      {
        codeVersion,
        codeScenario,
        crsLibelles: [],
        userEmail: a.utilisateurCreation,
      },
      analyseIa,
    );

    await this.auditSvc.log({
      utilisateur: user.email,
      typeAction: 'ANALYSE_IA_CONSULTEE',
      entiteCible: 'analyse_ia',
      idCible: a.id,
      statut: 'success',
      commentaire: `Export PDF analyse IA ${a.id} (${
        recalcule ? 'recalculé — dataset absent' : 'dataset figé — fidèle'
      }, ${String(buffer.length)} octets).`,
    });

    const filename = `MIZNAS_AnalyseIA_${a.id}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', String(buffer.length));
    res.end(buffer);
  }
}
