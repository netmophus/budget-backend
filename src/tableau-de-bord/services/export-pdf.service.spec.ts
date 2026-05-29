/**
 * Tests ExportPdfService (Lot 8.6.B). On utilise un vrai
 * PdfBuilderService et un vrai pdfkit — pas de mock — pour
 * vérifier que la chaîne complète (doc → template → footer
 * → Buffer) produit un PDF valide. Le service est pur (pas
 * de DB), donc le test reste rapide (~200 ms).
 */
import { PdfBuilderService } from '../../reporting/generators/pdf-builder.service';
import type { EcartsResponseDto, LigneEcartDto } from '../dto/tableau-bord.dto';
import { ExportPdfService, type ExportPdfMetadata } from './export-pdf.service';
import type { AnalyseAiSnapshot } from '../templates/tableau-bord-analyse.template';

function ligne(over: Partial<LigneEcartDto> = {}): LigneEcartDto {
  return {
    codeCr: 'CR_DARH',
    libelleCr: 'Dir. Admin',
    codeCompte: '641000',
    libelleCompte: 'Salaires',
    classeCompte: '6',
    natureCompte: 'CHARGE',
    codeLigneMetier: 'CHANGE',
    mois: '2026-05',
    libelleMois: 'Mai 2026',
    montantBudget: 100_000_000,
    montantRealise: 110_000_000,
    ecart: 10_000_000,
    ecartAbs: 10_000_000,
    ecartPct: 10,
    niveauAlerte: 'ATTENTION',
    sensEcart: 'DEFAVORABLE',
    ...over,
  };
}

function ecartsFixture(): EcartsResponseDto {
  return {
    filtres: {
      versionId: '1',
      scenarioId: '1',
      moisDebut: '2026-01',
      moisFin: '2026-06',
      seuilEcartPctAttention: 5,
      seuilEcartPctCritique: 10,
    },
    kpi: {
      nbEcartsTotal: 5,
      nbEcartsCritique: 1,
      nbEcartsAttention: 2,
      nbLignesManquantes: 1,
      ecartTotalAbs: 200_000_000,
      ecartTotalDefavorable: 130_000_000,
      ecartTotalFavorable: 70_000_000,
    },
    lignes: [
      ligne({ niveauAlerte: 'CRITIQUE', ecartAbs: 50_000_000 }),
      ligne({ niveauAlerte: 'ATTENTION', ecartAbs: 30_000_000 }),
      ligne({ niveauAlerte: 'ATTENTION', ecartAbs: 20_000_000 }),
      ligne({ niveauAlerte: 'NORMAL', ecartAbs: 5_000_000 }),
      ligne({
        niveauAlerte: 'MANQUANT',
        montantRealise: null,
        ecart: null,
        ecartAbs: null,
        ecartPct: null,
      }),
    ],
  };
}

const META: ExportPdfMetadata = {
  codeVersion: 'BUDGET_2026_v1.0',
  codeScenario: 'SCN_2026_CENTRAL',
  crsLibelles: [],
  userEmail: 'admin@miznas.local',
};

describe('ExportPdfService', () => {
  let svc: ExportPdfService;

  beforeEach(() => {
    svc = new ExportPdfService(new PdfBuilderService());
  });

  it('génère un PDF valide sans analyse IA (3 pages — header PDF présent, buffer > 5 KB)', async () => {
    const buffer = await svc.genererPdf(ecartsFixture(), META);
    expect(Buffer.isBuffer(buffer)).toBe(true);
    // Le PDF commence par %PDF-
    expect(buffer.slice(0, 5).toString('ascii')).toBe('%PDF-');
    // Le marqueur EOF se termine par %%EOF
    expect(buffer.slice(-6).toString('ascii').trim()).toMatch(/%%EOF/);
    // Taille minimale : 3 pages avec graphiques natifs > 5 KB
    expect(buffer.length).toBeGreaterThan(5_000);
  });

  it('génère un PDF avec analyse IA (4 pages — buffer plus volumineux que sans IA)', async () => {
    const analyseIa: AnalyseAiSnapshot = {
      analyse:
        '## Synthèse\n\nLes écarts ATTENTION dominent. **6 lignes** sur 538 dépassent le seuil de 5 %.\n\n### Recommandations\n\n- Vérifier le compte 702930\n- Croiser avec le réalisé du Q1\n',
      model: 'claude-sonnet-4-6',
      tokensInput: 1234,
      tokensOutput: 567,
      dureeMs: 8420,
      dryRun: false,
      generatedAt: '2026-05-29T19:30:00.000Z',
    };
    const sansIa = await svc.genererPdf(ecartsFixture(), META);
    const avecIa = await svc.genererPdf(ecartsFixture(), META, analyseIa);
    expect(avecIa.slice(0, 5).toString('ascii')).toBe('%PDF-');
    // La 4e page ajoute du contenu → buffer strictement plus gros.
    expect(avecIa.length).toBeGreaterThan(sansIa.length);
  });

  it('génère un PDF même quand 0 écart (état vide géré sans throw)', async () => {
    const ecartsVides: EcartsResponseDto = {
      ...ecartsFixture(),
      kpi: {
        nbEcartsTotal: 0,
        nbEcartsCritique: 0,
        nbEcartsAttention: 0,
        nbLignesManquantes: 0,
        ecartTotalAbs: 0,
        ecartTotalDefavorable: 0,
        ecartTotalFavorable: 0,
      },
      lignes: [],
    };
    const buffer = await svc.genererPdf(ecartsVides, META);
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.slice(0, 5).toString('ascii')).toBe('%PDF-');
    expect(buffer.length).toBeGreaterThan(2_000);
  });
});
