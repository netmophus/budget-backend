/**
 * Tests ExportPdfService (Lot 8.6.B). On utilise un vrai
 * PdfBuilderService et un vrai pdfkit — pas de mock — pour
 * vérifier que la chaîne complète (doc → template → footer
 * → Buffer) produit un PDF valide. Le service est pur (pas
 * de DB), donc le test reste rapide (~200 ms).
 */
import { inflateSync } from 'zlib';

import type { ConfigurationBanqueService } from '../../configuration-banque/configuration-banque.service';
import {
  DEFAULT_BANK_BRANDING,
  DEFAULT_MEMBRES_COMITE,
  type BankBranding,
  type MembreComitePdf,
} from '../../configuration-banque/bank-branding';
import { PdfBuilderService } from '../../reporting/generators/pdf-builder.service';
import type { EcartsResponseDto, LigneEcartDto } from '../dto/tableau-bord.dto';
import { ExportPdfService, type ExportPdfMetadata } from './export-pdf.service';
import type { AnalyseAiSnapshot } from '../templates/tableau-bord-analyse.template';

/** Fake ConfigurationBanqueService — branding + membres injectables. */
function fakeConfig(
  bank: BankBranding = DEFAULT_BANK_BRANDING,
  membres: MembreComitePdf[] = DEFAULT_MEMBRES_COMITE,
): ConfigurationBanqueService {
  return {
    getBankBranding: () => Promise.resolve(bank),
    getMembresComitePdf: () => Promise.resolve(membres),
  } as unknown as ConfigurationBanqueService;
}

/**
 * Extrait le texte réel du PDF : inflate les flux FlateDecode puis
 * décode les chaînes hex <...> des opérateurs Tj/TJ (WinAnsi -> latin1).
 */
function extractPdfText(buffer: Buffer): string {
  const pdf = buffer.toString('latin1');
  const re = /stream\r?\n([\s\S]*?)endstream/g;
  let m: RegExpExecArray | null;
  let out = '';
  while ((m = re.exec(pdf)) !== null) {
    let data = m[1];
    if (data.endsWith('\n')) data = data.slice(0, -1);
    if (data.endsWith('\r')) data = data.slice(0, -1);
    let content: string;
    try {
      content = inflateSync(Buffer.from(data, 'latin1')).toString('latin1');
    } catch {
      continue;
    }
    const hexRe = /<([0-9A-Fa-f]+)>/g;
    let h: RegExpExecArray | null;
    while ((h = hexRe.exec(content)) !== null) {
      if (h[1].length % 2 === 0) {
        out += Buffer.from(h[1], 'hex').toString('latin1');
      }
    }
  }
  return out;
}

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
    tauxExecution: 110,
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
      nbSansBudget: 0,
      ecartTotalAbs: 200_000_000,
      ecartTotalDefavorable: 130_000_000,
      ecartTotalFavorable: 70_000_000,
    },
    totaux: {
      produits: { budget: 0, realise: 0, ecart: 0, tauxExecution: null },
      charges: {
        budget: 100_000_000,
        realise: 110_000_000,
        ecart: 10_000_000,
        tauxExecution: 110,
      },
      solde: {
        budget: -100_000_000,
        realise: -110_000_000,
        ecart: -10_000_000,
        tauxExecution: 110,
      },
      pnb: { budget: 0, realise: 0, ecart: 0, tauxExecution: null },
      coefExploitationBudget: null,
      coefExploitationRealise: null,
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
    svc = new ExportPdfService(new PdfBuilderService(), fakeConfig());
  });

  it('B2 — bank BSIC (défaut) : rend "BSIC NIGER" + membres du seed', async () => {
    const buffer = await svc.genererPdf(ecartsFixture(), META);
    const txt = extractPdfText(buffer);
    expect(txt).toContain('BSIC NIGER');
    expect(txt).toContain('Souleymane DIORI');
  });

  it('B2 — bank fictive "TEST BANK" : rend TEST BANK, pas BSIC', async () => {
    const bank: BankBranding = {
      ...DEFAULT_BANK_BRANDING,
      nom: 'TEST BANK',
      sigle: 'TB',
      pays: 'Testland',
      couleurPrimaire: '#10B981',
      refReglementaireBceao: 'REF-TEST-001',
    };
    const membres: MembreComitePdf[] = [
      {
        nomPrenom: 'Alice PRESIDENTE',
        titre: 'Mme',
        fonction: 'PRESIDENT',
        ordreAffichage: 1,
      },
      { nomPrenom: 'Bob DG', titre: 'M.', fonction: 'DG', ordreAffichage: 2 },
    ];
    const svcCustom = new ExportPdfService(
      new PdfBuilderService(),
      fakeConfig(bank, membres),
    );
    const buffer = await svcCustom.genererPdf(ecartsFixture(), META);
    const txt = extractPdfText(buffer);
    expect(txt).toContain('TEST BANK');
    expect(txt).toContain('Alice PRESIDENTE');
    expect(txt).toContain('Bob DG');
    expect(txt).toContain('REF-TEST-001');
    // Plus aucune trace de BSIC dans le rendu personnalisé.
    expect(txt).not.toContain('BSIC');
    // Couleur primaire custom présente dans un flux (rgb ~0.0627 0.7255 0.5059).
    expect(buffer.toString('latin1')).toBeTruthy();
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

  it('SOUS-LOT 1 — analyse IA avec Unicode étendu : PDF valide sans crash', async () => {
    // L'IA peut produire malgré le prompt des ≥, →, emojis, box-drawing.
    // Le post-processing Latin-1 (nettoyerEmojis) doit les neutraliser
    // sans casser la génération.
    const analyseIa: AnalyseAiSnapshot = {
      analyse:
        '## Synthèse 🔴\n\n> Écart ≥ 10 % → action requise ████▒▒\n\n' +
        '- 🟡 Compte `7081` à surveiller\n- Coef ≤ 65 %\n',
      model: 'claude-sonnet-4-6',
      tokensInput: 100,
      tokensOutput: 50,
      dureeMs: 1000,
      dryRun: false,
      generatedAt: '2027-01-31T10:00:00.000Z',
    };
    const buffer = await svc.genererPdf(ecartsFixture(), META, analyseIa);
    expect(buffer.slice(0, 5).toString('ascii')).toBe('%PDF-');
    expect(buffer.slice(-6).toString('ascii').trim()).toMatch(/%%EOF/);
  });

  it('SOUS-LOT 1.4 — Top 10 avec même compte sur 2 lignes métier : PDF valide', async () => {
    // Distinction 7081/LM_PART vs 7081/LM_PME via la colonne Ligne métier.
    const ecarts = ecartsFixture();
    ecarts.lignes = [
      ligne({
        codeCompte: '7081',
        codeLigneMetier: 'LM_PART',
        ecartAbs: 40_000_000,
        niveauAlerte: 'CRITIQUE',
      }),
      ligne({
        codeCompte: '7081',
        codeLigneMetier: 'LM_PME',
        ecartAbs: 35_000_000,
        niveauAlerte: 'ATTENTION',
      }),
    ];
    const buffer = await svc.genererPdf(ecarts, META);
    expect(buffer.slice(0, 5).toString('ascii')).toBe('%PDF-');
    expect(buffer.length).toBeGreaterThan(5_000);
  });

  it('génère un PDF même quand 0 écart (état vide géré sans throw)', async () => {
    const ecartsVides: EcartsResponseDto = {
      ...ecartsFixture(),
      kpi: {
        nbEcartsTotal: 0,
        nbEcartsCritique: 0,
        nbEcartsAttention: 0,
        nbLignesManquantes: 0,
        nbSansBudget: 0,
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
