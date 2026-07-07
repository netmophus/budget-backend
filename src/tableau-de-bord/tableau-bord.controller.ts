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
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import {
  AiAnalyseRateLimiterService,
  type AiRateLimitResult,
} from '../ai/ai-rate-limiter.service';
import { AnthropicService } from '../ai/anthropic.service';
import { AnalyseIaService } from '../analyse-ia/analyse-ia.service';
import { estimerCoutUsd, PROMPT_VERSION } from '../analyse-ia/tarifs';
import { AuditService } from '../audit/audit.service';
import { ConfigurationBanqueService } from '../configuration-banque/configuration-banque.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import {
  EcartsResponseDto,
  ExportPdfDto,
  FiltresEcartsDto,
} from './dto/tableau-bord.dto';
import { AnalyseEcartsService } from './services/analyse-ecarts.service';
import { ExportExcelService } from './services/export-excel.service';
import { ExportPdfService } from './services/export-pdf.service';
import { StructureOrganisationnelleService } from './services/structure-organisationnelle.service';

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
    private readonly exportPdfSvc: ExportPdfService,
    // Chantier A — contexte enrichi du prompt IA (config banque + structure org).
    private readonly configBanque: ConfigurationBanqueService,
    private readonly structureOrg: StructureOrganisationnelleService,
    // Chantier C1 — historisation des analyses IA (persistance best-effort).
    private readonly analyseIaSvc: AnalyseIaService,
    @InjectDataSource()
    private readonly dataSource: DataSource,
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
      // Chantier A — contexte enrichi : identité/marché banque + structure
      // organisationnelle (CR filtrés périmètre user + lignes métier).
      const [bank, centresResponsabilite, lignesMetier] = await Promise.all([
        this.configBanque.getPromptContext(),
        this.structureOrg.getCentresResponsabilite(user),
        this.structureOrg.getLignesMetier(),
      ]);
      const result = await this.anthropicSvc.analyserEcarts(
        ecarts,
        user.email,
        { bank, centresResponsabilite, lignesMetier },
      );

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

      // 5. Chantier C1 — historisation BEST-EFFORT : si le save échoue,
      //    l'utilisateur reçoit quand même son analyse (on logge un warning).
      try {
        await this.analyseIaSvc.creer({
          fkUser: user.userId,
          demandeurEmail: user.email,
          dateGeneration: new Date(),
          versionId: filtres.versionId,
          scenarioId: filtres.scenarioId,
          moisDebut: filtres.moisDebut,
          moisFin: filtres.moisFin,
          crsSelectionnes: filtres.crIds ?? null,
          modele: result.model,
          promptVersion: PROMPT_VERSION,
          reponseMarkdown: result.analyse,
          kpiSnapshot: ecarts.kpi as unknown as Record<string, unknown>,
          tokensIn: result.tokensInput,
          tokensOut: result.tokensOutput,
          dureeMs: result.dureeMs,
          coutEstime: estimerCoutUsd(
            result.model,
            result.tokensInput,
            result.tokensOutput,
          ),
          dryRun: result.dryRun,
        });
      } catch (persistErr) {
        const m =
          persistErr instanceof Error ? persistErr.message : String(persistErr);
        this.logger.warn(
          `[C1] Historisation analyse IA échouée (analyse renvoyée quand même) : ${m}`,
        );
      }

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

  // ─── Lot 8.6.B — Export PDF Analyse Budget vs Réalisé ────────────
  @Post('export-pdf')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ all: ['BUDGET.LIRE', 'REALISE.LIRE'] })
  @ApiOperation({
    summary:
      'Export PDF du dashboard Budget vs Réalisé. 3 pages compactes (KPI / graphiques natifs / top 10 écarts) + 1 page optionnelle d’analyse MIZNAS AI si le frontend la transmet dans le body. Streamé en attachment (pas de stockage). 1 ligne audit_log EXPORT_PDF_TABLEAU_BORD par appel. Lot 8.6.B.',
  })
  @ApiProduces('application/pdf')
  @ApiOkResponse({
    description:
      'PDF binaire (application/pdf), Content-Disposition: attachment ; filename="MIZNAS_AnalyseBudget_<codeVersion>_<periode>_<date>.pdf".',
  })
  async exporterPdf(
    @Body() body: ExportPdfDto,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
  ): Promise<void> {
    const start = Date.now();
    let ecarts: EcartsResponseDto;

    // 1. Récupération des écarts (même appel que l'endpoint GET).
    try {
      ecarts = await this.analyseSvc.getBudgetVsRealise(body.filtres, user);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[PDF] Échec récupération écarts : ${msg}`);
      await this.auditSvc.log({
        utilisateur: user.email,
        typeAction: 'EXPORT_PDF_TABLEAU_BORD',
        entiteCible: 'tableau_bord',
        idCible: body.filtres.versionId,
        statut: 'failure',
        commentaire: 'Échec récupération écarts avant génération PDF.',
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

    // 2. Résolution des libellés metadata pour l'en-tête PDF
    //    (code_version + code_scenario via 2 SELECT légers).
    let codeVersion = body.filtres.versionId;
    let codeScenario = body.filtres.scenarioId;
    try {
      const versionRows = (await this.analyseSvc['dataSource']?.query<
        Array<{ code_version: string }>
      >(`SELECT code_version FROM dim_version WHERE id = $1 LIMIT 1`, [
        body.filtres.versionId,
      ])) as Array<{ code_version: string }> | undefined;
      if (versionRows && versionRows.length > 0) {
        codeVersion = versionRows[0].code_version;
      }
      const scenarioRows = (await this.analyseSvc['dataSource']?.query<
        Array<{ code_scenario: string }>
      >(`SELECT code_scenario FROM dim_scenario WHERE id = $1 LIMIT 1`, [
        body.filtres.scenarioId,
      ])) as Array<{ code_scenario: string }> | undefined;
      if (scenarioRows && scenarioRows.length > 0) {
        codeScenario = scenarioRows[0].code_scenario;
      }
    } catch {
      // Fallback silencieux : on garde les ids comme libellés.
    }

    // 3. Génération du PDF.
    let buffer: Buffer;
    try {
      buffer = await this.exportPdfSvc.genererPdf(
        ecarts,
        {
          codeVersion,
          codeScenario,
          crsLibelles: [], // MVP : pas de libellé CR détaillé dans le header
          userEmail: user.email,
        },
        body.analyseIa,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[PDF] Échec génération PDF : ${msg}`);
      await this.auditSvc.log({
        utilisateur: user.email,
        typeAction: 'EXPORT_PDF_TABLEAU_BORD',
        entiteCible: 'tableau_bord',
        idCible: body.filtres.versionId,
        statut: 'failure',
        commentaire: `Échec génération PDFKit (${msg}).`,
        payloadApres: { etape: 'genererPdf' },
        dureeMs: Date.now() - start,
      });
      throw new HttpException(
        {
          statusCode: 500,
          message:
            "Échec de génération PDF. Réessayez ou contactez l'administrateur.",
        },
        500,
      );
    }

    // 4. Audit succès — récap complet pour traçabilité BCEAO.
    await this.auditSvc.log({
      utilisateur: user.email,
      typeAction: 'EXPORT_PDF_TABLEAU_BORD',
      entiteCible: 'tableau_bord',
      idCible: body.filtres.versionId,
      statut: 'success',
      commentaire:
        `Export PDF ${codeVersion} (${body.filtres.moisDebut} → ${body.filtres.moisFin}) ` +
        `— ${String(ecarts.lignes.length)} ligne(s) analysée(s)` +
        (body.analyseIa ? ` avec analyse MIZNAS AI` : '') +
        `, ${String(buffer.length)} octets en ${String(Date.now() - start)} ms.`,
      payloadApres: {
        codeVersion,
        codeScenario,
        moisDebut: body.filtres.moisDebut,
        moisFin: body.filtres.moisFin,
        nbLignesAnalysees: ecarts.lignes.length,
        avecAnalyseIa: !!body.analyseIa,
        modeleIa: body.analyseIa?.model,
        tailleOctets: buffer.length,
      },
      dureeMs: Date.now() - start,
    });

    // 5. Réponse : streaming buffer + Content-Disposition.
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const safeVersion = codeVersion.replace(/[^A-Za-z0-9._-]/g, '_');
    const filename = `MIZNAS_AnalyseBudget_${safeVersion}_${body.filtres.moisDebut}_${body.filtres.moisFin}_${today}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', String(buffer.length));
    res.end(buffer);
  }
}
