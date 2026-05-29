/**
 * TableauBordController (Lot 5.2.C) — endpoints du tableau de
 * bord budget vs réalisé. Double permission BUDGET.LIRE +
 * REALISE.LIRE (avec mode 'all').
 */
import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpException,
  HttpStatus,
  Logger,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';

import {
  AiAnalyseRateLimiterService,
  type AiRateLimitResult,
} from '../ai/ai-rate-limiter.service';
import { AnthropicService } from '../ai/anthropic.service';
import { AuditService } from '../audit/audit.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { EcartsResponseDto, FiltresEcartsDto } from './dto/tableau-bord.dto';
import { AnalyseEcartsService } from './services/analyse-ecarts.service';
import { ExportExcelService } from './services/export-excel.service';

interface AiAnalyseReponseHttp {
  analyse: string;
  model: string;
  tokensInput: number;
  tokensOutput: number;
  dureeMs: number;
  dryRun: boolean;
}

@ApiTags('tableau-de-bord')
@ApiBearerAuth()
@Controller('tableau-de-bord')
export class TableauBordController {
  private readonly logger = new Logger(TableauBordController.name);

  constructor(
    private readonly analyseSvc: AnalyseEcartsService,
    private readonly exportSvc: ExportExcelService,
    private readonly anthropicSvc: AnthropicService,
    private readonly aiRateLimiter: AiAnalyseRateLimiterService,
    private readonly auditSvc: AuditService,
  ) {}

  @Get('budget-vs-realise')
  @RequirePermissions({ all: ['BUDGET.LIRE', 'REALISE.LIRE'] })
  @ApiOperation({
    summary:
      "Tableau de bord budget vs réalisé. Agrégation par (CR × compte × ligne métier × mois) avec calcul des écarts, niveaux d'alerte (NORMAL/ATTENTION/CRITIQUE/MANQUANT) et sens favorable/défavorable selon classe UEMOA. Filtrage périmètre user_perimetres en lecture.",
  })
  @ApiOkResponse({ type: EcartsResponseDto })
  getBudgetVsRealise(
    @Query() filtres: FiltresEcartsDto,
    @CurrentUser() user: AuthUser,
  ): Promise<EcartsResponseDto> {
    return this.analyseSvc.getBudgetVsRealise(filtres, user);
  }

  @Get('budget-vs-realise/export')
  @RequirePermissions({ all: ['BUDGET.LIRE', 'REALISE.LIRE'] })
  @Header(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  )
  @ApiOperation({
    summary:
      'Export Excel (.xlsx) du tableau de bord. 3 onglets : Synthèse (KPI), Détail des écarts (mise en forme conditionnelle sur la colonne Niveau), Filtres.',
  })
  async exportXlsx(
    @Query() filtres: FiltresEcartsDto,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
  ): Promise<void> {
    const ecarts = await this.analyseSvc.getBudgetVsRealise(filtres, user);
    const buf = await this.exportSvc.genererXlsx(ecarts, filtres.versionId);
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const filename = `ecarts-budget-realise-${filtres.versionId}-${today}.xlsx`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', String(buf.length));
    res.end(buf);
  }

  // ─── Lot 8.6.A — MIZNAS AI analyse Budget vs Réalisé ──────────────
  @Post('analyse-ai')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('AI.ANALYSER')
  @ApiOperation({
    summary:
      'Analyse MIZNAS AI du dashboard Budget vs Réalisé. Appel synchrone à Claude (Anthropic) qui produit un commentaire markdown structuré. Rate-limité (3 / min + 10 / jour par utilisateur). 1 ligne audit_log AI_ANALYSE_DEMANDEE par appel. Lot 8.6.A.',
  })
  @ApiOkResponse({
    description:
      'Réponse JSON { analyse: markdown, model, tokensInput, tokensOutput, dureeMs, dryRun }.',
  })
  async analyseAi(
    @Body() filtres: FiltresEcartsDto,
    @CurrentUser() user: AuthUser,
  ): Promise<AiAnalyseReponseHttp> {
    const start = Date.now();

    // 1. Rate limit
    const rl: AiRateLimitResult = this.aiRateLimiter.enregistrerEtVerifier(
      user.userId,
    );
    if (rl.bloque) {
      // Audit l'échec pour traçabilité conso/abus.
      await this.auditSvc.log({
        utilisateur: user.email,
        typeAction: 'AI_ANALYSE_DEMANDEE',
        entiteCible: 'tableau_bord',
        idCible: filtres.versionId,
        statut: 'failure',
        commentaire: `Rate limit atteint (${rl.motif}). Retry dans ${String(rl.retryAfterSeconds ?? 0)}s.`,
        payloadApres: {
          motif: rl.motif,
          retryAfterSeconds: rl.retryAfterSeconds,
        },
        dureeMs: Date.now() - start,
      });
      throw new HttpException(
        {
          statusCode: 429,
          message:
            rl.motif === 'BURST'
              ? `Trop d'analyses récentes. Réessayez dans ${String(rl.retryAfterSeconds ?? 0)} secondes.`
              : `Quota journalier MIZNAS AI atteint (10 analyses / 24h). Réessayez dans ${String(Math.ceil((rl.retryAfterSeconds ?? 0) / 3600))} heure(s).`,
          retryAfterSeconds: rl.retryAfterSeconds,
        },
        429,
      );
    }

    // 2. Récupération des écarts via AnalyseEcartsService (réutilise
    //    la double permission BUDGET.LIRE + REALISE.LIRE en interne
    //    via le filtrage périmètre — l'utilisateur a déjà AI.ANALYSER
    //    qui ne donne PAS accès aux écarts en propre).
    let ecarts: EcartsResponseDto;
    try {
      ecarts = await this.analyseSvc.getBudgetVsRealise(filtres, user);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[AI] Échec récupération écarts : ${msg}`);
      await this.auditSvc.log({
        utilisateur: user.email,
        typeAction: 'AI_ANALYSE_DEMANDEE',
        entiteCible: 'tableau_bord',
        idCible: filtres.versionId,
        statut: 'failure',
        commentaire: 'Échec récupération écarts avant appel IA.',
        payloadApres: { etape: 'getBudgetVsRealise' },
        dureeMs: Date.now() - start,
      });
      throw new HttpException(
        {
          statusCode: 500,
          message:
            "Impossible de récupérer les écarts. Lancez d'abord une analyse classique puis réessayez.",
        },
        500,
      );
    }

    // 3. Appel Anthropic (ou mock si AI_DRY_RUN=true)
    try {
      const result = await this.anthropicSvc.analyserEcarts(ecarts, user.email);

      // 4. Audit succès (récap, sans le prompt ni la réponse — volatile
      //    côté client uniquement).
      await this.auditSvc.log({
        utilisateur: user.email,
        typeAction: 'AI_ANALYSE_DEMANDEE',
        entiteCible: 'tableau_bord',
        idCible: filtres.versionId,
        statut: 'success',
        commentaire:
          `Analyse MIZNAS AI ${result.dryRun ? '[dry-run] ' : ''}` +
          `(${String(result.tokensInput)} in + ${String(result.tokensOutput)} out tokens, ` +
          `${String(result.dureeMs)} ms).`,
        payloadApres: {
          filtres: {
            versionId: filtres.versionId,
            scenarioId: filtres.scenarioId,
            moisDebut: filtres.moisDebut,
            moisFin: filtres.moisFin,
          },
          kpiSnapshot: ecarts.kpi,
          nbLignesAnalysees: ecarts.lignes.length,
          model: result.model,
          tokensInput: result.tokensInput,
          tokensOutput: result.tokensOutput,
          dryRun: result.dryRun,
        },
        dureeMs: Date.now() - start,
      });

      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[AI] Échec analyse pour ${user.email} : ${msg}`);
      await this.auditSvc.log({
        utilisateur: user.email,
        typeAction: 'AI_ANALYSE_DEMANDEE',
        entiteCible: 'tableau_bord',
        idCible: filtres.versionId,
        statut: 'failure',
        commentaire: `Échec appel Anthropic (${msg}).`,
        payloadApres: { etape: 'anthropicService.analyserEcarts' },
        dureeMs: Date.now() - start,
      });
      // Le service a déjà wrappé l'erreur SDK en 'AI_PROVIDER_ERROR'.
      // On expose un message générique au client (pas de leak SDK).
      throw new HttpException(
        {
          statusCode: 502,
          message:
            "MIZNAS AI n'a pas pu produire l'analyse (service indisponible). Réessayez dans quelques minutes.",
        },
        502,
      );
    }
  }
}
