/**
 * Tests AnthropicService (Lot 8.6.A).
 *
 * Stratégie : SDK Anthropic mocké par jest.mock pour ne JAMAIS faire
 * d'appel réseau réel. Vérifie :
 *  1. Mode AI_DRY_RUN=true (défaut) → réponse mockée, SDK pas appelé
 *  2. Mode réel : appel SDK, propage tokens + dureeMs
 *  3. Erreur SDK → wrap en 'AI_PROVIDER_ERROR' (jamais le message brut)
 *  4. construirePrompt() inclut KPI + top lignes + résumé mensuel
 */
import { ConfigService } from '@nestjs/config';

import { AnthropicService } from './anthropic.service';
import type { EcartsResponseDto } from '../tableau-de-bord/dto/tableau-bord.dto';

// Mock du SDK Anthropic. Le client renvoyé expose `messages.create`.
const mockCreate = jest.fn();
jest.mock('@anthropic-ai/sdk', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      messages: { create: mockCreate },
    })),
  };
});

function makeConfig(overrides: Record<string, string> = {}): ConfigService {
  const map: Record<string, string> = {
    AI_DRY_RUN: 'true',
    ANTHROPIC_MODEL: 'claude-sonnet-4-6',
    ...overrides,
  };
  return {
    get: <T>(key: string, defaut?: T): T | string | undefined =>
      map[key] ?? (defaut as T | undefined),
  } as unknown as ConfigService;
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
      nbEcartsTotal: 3,
      nbEcartsCritique: 1,
      nbEcartsAttention: 1,
      nbLignesManquantes: 1,
      nbSansBudget: 0,
      ecartTotalAbs: 200_000_000,
      ecartTotalDefavorable: 120_000_000,
      ecartTotalFavorable: 80_000_000,
    },
    totaux: {
      produits: {
        budget: 100_000_000,
        realise: 82_000_000,
        ecart: -18_000_000,
        tauxExecution: 82,
      },
      charges: {
        budget: 70_000_000,
        realise: 53_500_000,
        ecart: -16_500_000,
        tauxExecution: 76.4,
      },
      solde: {
        budget: 30_000_000,
        realise: 28_500_000,
        ecart: -1_500_000,
        tauxExecution: 95,
      },
      pnb: {
        budget: 100_000_000,
        realise: 82_000_000,
        ecart: -18_000_000,
        tauxExecution: 82,
      },
      coefExploitationBudget: 70,
      coefExploitationRealise: 65.2,
    },
    lignes: [
      {
        codeCr: 'CR_AG_SIEGE',
        libelleCr: 'CR AG SIEGE',
        codeCompte: '702930',
        libelleCompte: 'Commissions effets',
        classeCompte: '7',
        natureCompte: 'PRODUIT',
        codeLigneMetier: 'CHANGE',
        mois: '2026-05',
        libelleMois: 'Mai 2026',
        montantBudget: 100_000_000,
        montantRealise: 82_000_000,
        ecart: -18_000_000,
        ecartAbs: 18_000_000,
        ecartPct: -18,
        tauxExecution: 82,
        niveauAlerte: 'CRITIQUE',
        sensEcart: 'DEFAVORABLE',
      },
      {
        codeCr: 'CR_DARH',
        libelleCr: 'CR DARH',
        codeCompte: '623200',
        libelleCompte: 'Indemnités',
        classeCompte: '6',
        natureCompte: 'CHARGE',
        codeLigneMetier: 'CHANGE',
        mois: '2026-05',
        libelleMois: 'Mai 2026',
        montantBudget: 50_000_000,
        montantRealise: 53_500_000,
        ecart: 3_500_000,
        ecartAbs: 3_500_000,
        ecartPct: 7,
        tauxExecution: 107,
        niveauAlerte: 'ATTENTION',
        sensEcart: 'DEFAVORABLE',
      },
      {
        codeCr: 'CR_FINANCE',
        libelleCr: 'CR FINANCE',
        codeCompte: '622100',
        libelleCompte: 'Loyers',
        classeCompte: '6',
        natureCompte: 'CHARGE',
        codeLigneMetier: 'CHANGE',
        mois: '2026-03',
        libelleMois: 'Mars 2026',
        montantBudget: 20_000_000,
        montantRealise: null,
        ecart: null,
        ecartAbs: null,
        ecartPct: null,
        tauxExecution: null,
        niveauAlerte: 'MANQUANT',
        sensEcart: null,
      },
    ],
  };
}

describe('AnthropicService', () => {
  let svc: AnthropicService;

  beforeEach(() => {
    mockCreate.mockReset();
  });

  it('AI_DRY_RUN=true → réponse mockée, SDK pas appelé', async () => {
    svc = new AnthropicService(makeConfig({ AI_DRY_RUN: 'true' }));
    const r = await svc.analyserEcarts(ecartsFixture(), 'admin@miznas.local');
    expect(r.dryRun).toBe(true);
    expect(r.tokensInput).toBe(0);
    expect(r.tokensOutput).toBe(0);
    expect(r.model).toBe('claude-sonnet-4-6-mocked');
    expect(r.analyse).toMatch(/MIZNAS AI/);
    expect(r.analyse).toMatch(/1 écart\(s\) CRITIQUE/);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('AI_DRY_RUN=false sans clé → throw au 1er appel', async () => {
    svc = new AnthropicService(
      makeConfig({ AI_DRY_RUN: 'false', ANTHROPIC_API_KEY: '' }),
    );
    await expect(
      svc.analyserEcarts(ecartsFixture(), 'admin@miznas.local'),
    ).rejects.toThrow(/ANTHROPIC_API_KEY manquant/);
  });

  it('AI_DRY_RUN=false avec clé : appelle SDK, propage tokens/durée', async () => {
    mockCreate.mockResolvedValue({
      model: 'claude-sonnet-4-6-20251029',
      content: [{ type: 'text', text: '## Synthèse\nÉcart critique détecté…' }],
      usage: { input_tokens: 1234, output_tokens: 567 },
    });
    svc = new AnthropicService(
      makeConfig({ AI_DRY_RUN: 'false', ANTHROPIC_API_KEY: 'sk-fake-key' }),
    );
    const r = await svc.analyserEcarts(ecartsFixture(), 'admin@miznas.local');
    expect(r.dryRun).toBe(false);
    expect(r.tokensInput).toBe(1234);
    expect(r.tokensOutput).toBe(567);
    expect(r.model).toBe('claude-sonnet-4-6-20251029');
    expect(r.analyse).toMatch(/Synthèse/);
    expect(mockCreate).toHaveBeenCalledTimes(1);
    // Vérifie que le prompt user contient bien les chiffres clés
    const call = mockCreate.mock.calls[0]![0] as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(call.messages[0]!.content).toMatch(/Niveau CRITIQUE : 1/);
    expect(call.messages[0]!.content).toMatch(/702930/);
  });

  it('SDK error → wrap en AI_PROVIDER_ERROR (jamais le message brut)', async () => {
    mockCreate.mockRejectedValue(new Error('SDK_INTERNAL_DETAIL_xyz'));
    svc = new AnthropicService(
      makeConfig({ AI_DRY_RUN: 'false', ANTHROPIC_API_KEY: 'sk-fake-key' }),
    );
    await expect(
      svc.analyserEcarts(ecartsFixture(), 'admin@miznas.local'),
    ).rejects.toThrow('AI_PROVIDER_ERROR');
  });

  it('construirePrompt inclut KPI + top lignes CRITIQUE/ATTENTION + résumé mensuel', () => {
    svc = new AnthropicService(makeConfig());
    const prompt = svc.construirePrompt(ecartsFixture());
    // KPI clés
    expect(prompt).toMatch(/Niveau CRITIQUE : 1/);
    expect(prompt).toMatch(/Niveau ATTENTION : 1/);
    expect(prompt).toMatch(/Lignes manquantes \(sans réalisé\) : 1/);
    // Top lignes : MANQUANT (compte 622100) doit être exclu (ecartAbs null)
    expect(prompt).toMatch(/702930/);
    expect(prompt).toMatch(/623200/);
    expect(prompt).not.toMatch(/622100/);
    // Résumé mensuel présent
    expect(prompt).toMatch(/Évolution mensuelle/);
    expect(prompt).toMatch(/Mai 2026/);
  });
});
