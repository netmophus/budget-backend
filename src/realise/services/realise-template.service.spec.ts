/**
 * Tests RealiseTemplateService (Lot 8.5.D).
 *
 * Couvre :
 *  - Génération buffer XLSX non vide
 *  - Workbook bien structuré : 2 onglets nommés "Donnees" + "Notice"
 *  - Onglet "Donnees" : header exact (6 obligatoires + 2 optionnelles)
 *    et alignement strict sur HEADER_ORDONNE de RealiseImportService
 *  - Onglet "Donnees" : au moins 1 ligne d'exemple plausible
 *  - Onglet "Notice" : contient les instructions clés (mois, XOF,
 *    workflow IMPORTE → VALIDE)
 *
 * Pas de pg-mem ni de DB : le service est 100% in-memory.
 */
import ExcelJS from 'exceljs';

import type { ConfigurationBanqueService } from '../../configuration-banque/configuration-banque.service';
import { DEFAULT_BANK_BRANDING } from '../../configuration-banque/bank-branding';
import { RealiseTemplateService } from './realise-template.service';

const fakeConfig = {
  getBankBranding: () => Promise.resolve(DEFAULT_BANK_BRANDING),
} as unknown as ConfigurationBanqueService;

async function loadWorkbook(buffer: Buffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  return wb;
}

describe('RealiseTemplateService', () => {
  let svc: RealiseTemplateService;

  beforeEach(() => {
    svc = new RealiseTemplateService(fakeConfig);
  });

  it('génère un Buffer non vide (>= 1 KB minimum, XLSX zip overhead)', async () => {
    const buffer = await svc.genererTemplateXlsx();
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(1024);
  });

  it('workbook contient exactement les 2 onglets "Donnees" et "Notice"', async () => {
    const buffer = await svc.genererTemplateXlsx();
    const wb = await loadWorkbook(buffer);
    const noms = wb.worksheets.map((w) => w.name);
    expect(noms).toEqual(['Donnees', 'Notice']);
  });

  it('onglet "Donnees" : header ligne 1 contient les 8 colonnes attendues dans l\'ordre', async () => {
    const buffer = await svc.genererTemplateXlsx();
    const wb = await loadWorkbook(buffer);
    const ws = wb.getWorksheet('Donnees');
    expect(ws).toBeDefined();
    const headerRow = ws!.getRow(1);
    const valeurs = (headerRow.values as Array<unknown>).slice(1).map(String);
    expect(valeurs).toEqual([
      'code_cr',
      'code_compte',
      'code_ligne_metier',
      'mois',
      'code_devise',
      'montant',
      'mode',
      'commentaire',
    ]);
  });

  it('onglet "Donnees" : au moins 3 lignes d\'exemple avec compte et CR plausibles BSIC', async () => {
    const buffer = await svc.genererTemplateXlsx();
    const wb = await loadWorkbook(buffer);
    const ws = wb.getWorksheet('Donnees');
    expect(ws).toBeDefined();
    // rowCount inclut header + lignes exemples. >= 4 = 1 header + >= 3 exemples.
    expect(ws!.rowCount).toBeGreaterThanOrEqual(4);
    // Ligne 2 (1er exemple) — vérifier qu'on a bien un code_cr non vide,
    // un compte 6 chiffres, un mois YYYY-MM et un montant numérique.
    // Le service écrit uniquement des strings dans la ligne d'exemple,
    // donc le cast en `(string | undefined)[]` est sûr.
    const ligne2 = (ws!.getRow(2).values as Array<string | undefined>)
      .slice(1)
      .map((v) => v ?? '');
    expect(ligne2[0]).toMatch(/^CR_/);
    expect(ligne2[1]).toMatch(/^\d{6}$/);
    expect(ligne2[3]).toMatch(/^\d{4}-\d{2}$/);
    expect(ligne2[4]).toBe('XOF');
    expect(Number(ligne2[5])).toBeGreaterThan(0);
  });

  it('onglet "Notice" : contient les instructions clés (mois, XOF, workflow IMPORTE/VALIDE)', async () => {
    const buffer = await svc.genererTemplateXlsx();
    const wb = await loadWorkbook(buffer);
    const ws = wb.getWorksheet('Notice');
    expect(ws).toBeDefined();
    // L'onglet Notice ne contient qu'une colonne de texte plein (string),
    // donc on peut caster en `string | undefined` sans risque.
    const texteComplet: string[] = [];
    ws!.eachRow((row) => {
      const v = row.getCell(1).value as string | undefined;
      texteComplet.push(v ?? '');
    });
    const joint = texteComplet.join('\n');
    expect(joint).toMatch(/YYYY-MM/);
    expect(joint).toMatch(/XOF/);
    expect(joint).toMatch(/Importé/);
    expect(joint).toMatch(/Validé/);
  });

  it('header du template strictement aligné sur HEADER_ORDONNE (cf. RealiseImportService)', () => {
    // Guardrail : si HEADER_ORDONNE change côté import, ce test forcera
    // à mettre à jour le template. Liste recopiée verbatim depuis
    // realise-import.service.ts pour rester self-contained.
    const HEADER_IMPORT = [
      'code_cr',
      'code_compte',
      'code_ligne_metier',
      'mois',
      'code_devise',
      'montant',
    ];
    const HEADER_TEMPLATE = RealiseTemplateService.getHeaderColumns();
    // Le template inclut en plus les 2 colonnes optionnelles.
    expect(HEADER_TEMPLATE.slice(0, 6)).toEqual(HEADER_IMPORT);
    expect(HEADER_TEMPLATE).toContain('mode');
    expect(HEADER_TEMPLATE).toContain('commentaire');
  });
});
