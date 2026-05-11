/**
 * Tests ExportExcelService (Lot 5.2.B) — vérifient la structure
 * du .xlsx (3 onglets, en-têtes, KPI, mise en forme conditionnelle).
 */
import ExcelJS from 'exceljs';

import { EcartsResponseDto, type LigneEcartDto } from '../dto/tableau-bord.dto';
import { ExportExcelService } from './export-excel.service';

function makeLigne(over: Partial<LigneEcartDto> = {}): LigneEcartDto {
  return {
    codeCr: 'CR_BANDABARI',
    libelleCr: 'Bandabari',
    codeCompte: '701100',
    libelleCompte: 'Commissions',
    classeCompte: '7',
    natureCompte: 'PRODUIT',
    codeLigneMetier: 'RETAIL',
    mois: '2027-03',
    libelleMois: 'Mars 2027',
    montantBudget: 5_000_000,
    montantRealise: 4_800_000,
    ecart: -200_000,
    ecartAbs: 200_000,
    ecartPct: -4,
    niveauAlerte: 'NORMAL',
    sensEcart: 'DEFAVORABLE',
    ...over,
  };
}

function makeEcarts(): EcartsResponseDto {
  return {
    filtres: {
      versionId: '1',
      scenarioId: '2',
      moisDebut: '2027-01',
      moisFin: '2027-03',
      seuilEcartPctAttention: 5,
      seuilEcartPctCritique: 10,
    },
    kpi: {
      nbEcartsTotal: 4,
      nbEcartsCritique: 1,
      nbEcartsAttention: 1,
      nbLignesManquantes: 1,
      ecartTotalAbs: 220_000,
      ecartTotalDefavorable: 150_000,
      ecartTotalFavorable: 70_000,
    },
    lignes: [
      makeLigne({ niveauAlerte: 'CRITIQUE', ecartAbs: 150_000 }),
      makeLigne({ niveauAlerte: 'ATTENTION', ecartAbs: 70_000 }),
      makeLigne({
        niveauAlerte: 'MANQUANT',
        montantRealise: null,
        ecart: null,
        ecartAbs: null,
        ecartPct: null,
        sensEcart: null,
      }),
      makeLigne({ niveauAlerte: 'NORMAL', ecartAbs: 1_000 }),
    ],
  };
}

async function loadXlsxFromBuffer(buf: Buffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  return wb;
}

describe('ExportExcelService', () => {
  let svc: ExportExcelService;

  beforeEach(() => {
    svc = new ExportExcelService();
  });

  it('génère un .xlsx valide avec 3 onglets', async () => {
    const buf = await svc.genererXlsx(makeEcarts(), 'BI_2027');
    expect(buf.length).toBeGreaterThan(1000);
    const wb = await loadXlsxFromBuffer(buf);
    const noms = wb.worksheets.map((w) => w.name).sort();
    expect(noms).toEqual(['Détail des écarts', 'Filtres', 'Synthèse']);
  });

  it('onglet Synthèse contient les KPI cohérents', async () => {
    const buf = await svc.genererXlsx(makeEcarts(), 'BI_2027');
    const wb = await loadXlsxFromBuffer(buf);
    const ws = wb.getWorksheet('Synthèse')!;
    // Récupère toutes les cellules clé/valeur (col A = key, col B = val)
    const keys: Array<string | undefined> = [];
    const vals: Array<unknown> = [];
    ws.eachRow((row) => {
      keys.push(row.getCell(1).value as string | undefined);
      vals.push(row.getCell(2).value);
    });
    // Vérifie quelques entrées
    const idxNbCritique = keys.indexOf('Nb écarts CRITIQUES');
    expect(idxNbCritique).toBeGreaterThan(0);
    expect(vals[idxNbCritique]).toBe(1);
    const idxEcartTotal = keys.indexOf('Écart total absolu (FCFA)');
    expect(vals[idxEcartTotal]).toBe(220_000);
  });

  it('onglet Détail applique la couleur de fond conditionnelle sur la colonne Niveau', async () => {
    const buf = await svc.genererXlsx(makeEcarts(), 'BI_2027');
    const wb = await loadXlsxFromBuffer(buf);
    const ws = wb.getWorksheet('Détail des écarts')!;
    // Header attendu en ligne 1
    expect(ws.getCell('M1').value).toBe('Niveau');
    // 4 lignes de données (lignes 2 à 5)
    const couleursAttendues: Record<number, string> = {
      // Tri par ecartAbs décroissant : NORMAL ecartAbs = 1000 → ligne 5 (en bas).
      // L'ordre EXACT est l'ordre fourni dans `lignes` du DTO :
      // [CRITIQUE 150K, ATTENTION 70K, MANQUANT, NORMAL 1K]
      2: 'FFC7CE', // CRITIQUE rouge clair
      3: 'FFEB9C', // ATTENTION orange clair
      4: 'D9D9D9', // MANQUANT gris clair
      5: 'C6EFCE', // NORMAL vert clair
    };
    for (const [row, argb] of Object.entries(couleursAttendues)) {
      const cell = ws.getCell(`M${row}`);
      const fill = cell.fill as ExcelJS.FillPattern | undefined;
      expect(fill?.type).toBe('pattern');
      expect((fill?.fgColor as { argb?: string } | undefined)?.argb).toBe(argb);
    }
  });

  it("onglet Filtres reflète les paramètres d'analyse", async () => {
    const buf = await svc.genererXlsx(makeEcarts(), 'BI_2027');
    const wb = await loadXlsxFromBuffer(buf);
    const ws = wb.getWorksheet('Filtres')!;
    const lignes: Array<[string, string | number]> = [];
    ws.eachRow((row, idx) => {
      if (idx === 1) return; // header
      lignes.push([
        String(row.getCell(1).value),
        row.getCell(2).value as string | number,
      ]);
    });
    expect(lignes).toContainEqual(['Mois début', '2027-01']);
    expect(lignes).toContainEqual(['Mois fin', '2027-03']);
    expect(lignes).toContainEqual(['Seuil ATTENTION (%)', 5]);
    expect(lignes).toContainEqual(['Seuil CRITIQUE (%)', 10]);
  });
});
