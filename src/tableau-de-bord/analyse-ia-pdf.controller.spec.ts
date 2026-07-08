/**
 * Tests AnalyseIaPdfController (Chantier C-fix) — services mockés.
 * Vérifie le cœur : dataset figé -> PDF depuis le snapshot (PAS de recalcul) ;
 * sans dataset -> repli getBudgetVsRealise.
 */
import type { Response } from 'express';

import type { AnalyseIaService } from '../analyse-ia/analyse-ia.service';
import type { AnalyseIa } from '../analyse-ia/entities/analyse-ia.entity';
import type { AuthUser } from '../auth/decorators/current-user.decorator';
import type { AuditService } from '../audit/audit.service';
import { AnalyseIaPdfController } from './analyse-ia-pdf.controller';
import type { AnalyseEcartsService } from './services/analyse-ecarts.service';
import type { ExportPdfService } from './services/export-pdf.service';

const USER: AuthUser = { userId: '1', email: 'a@miznas.local' };

function entite(overrides: Partial<AnalyseIa> = {}): AnalyseIa {
  return {
    id: '1',
    fkUser: '1',
    dateGeneration: new Date('2027-02-01T10:00:00Z'),
    versionId: '10',
    scenarioId: '20',
    moisDebut: '2027-01',
    moisFin: '2027-03',
    crsSelectionnes: null,
    modele: 'claude-sonnet-4-6',
    promptVersion: 'chantier-a-v1',
    reponseMarkdown: '## Diagnostic\nOK',
    kpiSnapshot: null,
    tokensIn: 100,
    tokensOut: 200,
    dureeMs: 500,
    coutEstime: '0.03300',
    dryRun: false,
    datasetSnapshot: null,
    statut: 'success',
    dateCreation: new Date(),
    utilisateurCreation: 'a@miznas.local',
    ...overrides,
  } as AnalyseIa;
}

function make(entity: AnalyseIa) {
  const analyseIaSvc = {
    getPourExport: jest.fn().mockResolvedValue(entity),
  } as unknown as AnalyseIaService;
  const analyseSvc = {
    getBudgetVsRealise: jest.fn().mockResolvedValue({ RECALC: true }),
  } as unknown as AnalyseEcartsService;
  const exportPdfSvc = {
    genererPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-fake')),
  } as unknown as ExportPdfService;
  const auditSvc = {
    log: jest.fn().mockResolvedValue(undefined),
  } as unknown as AuditService;
  const ctrl = new AnalyseIaPdfController(
    analyseIaSvc,
    analyseSvc,
    exportPdfSvc,
    auditSvc,
  );
  return { ctrl, analyseSvc, exportPdfSvc };
}

const res = {
  setHeader: jest.fn(),
  end: jest.fn(),
} as unknown as Response;

describe('AnalyseIaPdfController (Chantier C-fix)', () => {
  afterEach(() => jest.clearAllMocks());

  it('dataset figé -> PDF depuis le snapshot, PAS de recalcul', async () => {
    const { ctrl, analyseSvc, exportPdfSvc } = make(
      entite({
        datasetSnapshot: {
          ecarts: { FROZEN: true },
          codeVersion: 'BI_2027',
          codeScenario: 'CENTRAL',
        },
      }),
    );
    await ctrl.exportPdf('1', USER, res);
    expect(analyseSvc.getBudgetVsRealise).not.toHaveBeenCalled();
    expect(exportPdfSvc.genererPdf).toHaveBeenCalledWith(
      { FROZEN: true },
      expect.objectContaining({ codeVersion: 'BI_2027' }),
      expect.objectContaining({ analyse: '## Diagnostic\nOK' }),
    );
    expect(res.end).toHaveBeenCalled();
  });

  it('sans dataset -> repli getBudgetVsRealise', async () => {
    const { ctrl, analyseSvc, exportPdfSvc } = make(
      entite({ datasetSnapshot: null }),
    );
    await ctrl.exportPdf('1', USER, res);
    expect(analyseSvc.getBudgetVsRealise).toHaveBeenCalledTimes(1);
    expect(exportPdfSvc.genererPdf).toHaveBeenCalledWith(
      { RECALC: true },
      expect.any(Object),
      expect.any(Object),
    );
  });
});
