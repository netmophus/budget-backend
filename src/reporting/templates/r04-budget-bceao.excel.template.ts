/**
 * Template Excel du rapport R04 "Budget Publié BCEAO" (Lot 7.6 — Palier 3).
 *
 * 5 onglets :
 *   1. Synthèse          — titre fusionné + métadonnées workflow + KPI cards
 *   2. Compte de résultat — sections A produits (vert) + B charges (orange)
 *   3. Par CR             — 17 lignes + sous-totaux par type_cr + total
 *   4. Détail comptes     — filtres activés + couleurs par classe 6/7
 *   5. Audit trail        — 3 lignes minimum (E1/E2/E3)
 *
 * Le template écrit dans le `wb` fourni par l'appelant (service R04).
 * Le caller récupère ensuite le Buffer via `ExcelBuilderService.toBuffer()`.
 */
import ExcelJS from 'exceljs';

import {
  BSIC_EXCEL_COLORS,
  type ExcelBuilderService,
} from '../generators/excel-builder.service';
import type { R04Donnees } from '../services/r04-budget-bceao.service';

// ─── Mappings (dupliqués du template PDF pour découplage) ────────────

const PCB_LIBELLES_SOUS_CLASSE_PRODUITS: Record<string, string> = {
  '70': 'Produits sur opérations interbancaires',
  '71': 'Produits sur opérations avec la clientèle',
  '72': 'Produits sur opérations sur titres',
  '73': 'Produits divers',
  '74': 'Reprises de provisions',
  '75': 'Récupérations sur créances amorties',
  '76': 'Produits accessoires',
  '77': 'Produits sur opérations hors bilan',
  '78': 'Produits exceptionnels',
  '79': 'Autres produits',
};

const PCB_LIBELLES_SOUS_CLASSE_CHARGES: Record<string, string> = {
  '60': "Charges d'intermédiation",
  '61': 'Charges sur opérations avec la clientèle',
  '62': 'Charges sur opérations sur titres',
  '63': "Charges générales d'exploitation",
  '64': 'Charges de personnel',
  '65': 'Impôts et taxes',
  '66': 'Charges diverses',
  '67': 'Dotations aux amortissements et provisions',
  '68': 'Charges exceptionnelles',
  '69': 'Autres charges',
};

const TYPE_CR_LIBELLES: Record<string, string> = {
  cdc: 'Centre de Coût',
  cdr: 'Centre de Revenu',
  cdp: 'Centre de Profit',
};

const TYPE_VERSION_LIBELLES: Record<string, string> = {
  budget_initial: 'Budget initial',
  reforecast_1: 'Reforecast 1',
  reforecast_2: 'Reforecast 2',
  reforecast: 'Reforecast trimestriel',
  atterrissage: 'Atterrissage',
};

function libelleSousClasse(classe: string, sousClasse: string): string {
  const map =
    classe === '7'
      ? PCB_LIBELLES_SOUS_CLASSE_PRODUITS
      : PCB_LIBELLES_SOUS_CLASSE_CHARGES;
  return map[sousClasse] ?? `Sous-classe ${sousClasse}`;
}

function fmtDateFr(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// ─── Onglet 1 — Synthèse ─────────────────────────────────────────────

function buildSyntheseSheet(
  wb: ExcelJS.Workbook,
  d: R04Donnees,
  _helper: ExcelBuilderService,
): void {
  // L'onglet Synthèse ne consomme pas les helpers (fonts/fills custom
  // sur cellules fusionnées) — paramètre conservé pour homogénéité de
  // signature avec les 4 autres `buildXxxSheet`.
  const ws = wb.addWorksheet('Synthèse');
  ws.columns = [{ width: 38 }, { width: 42 }, { width: 24 }];

  // Titre fusionné
  ws.mergeCells('A1:C1');
  const titleCell = ws.getCell('A1');
  titleCell.value = `BUDGET ${d.version.exercice_fiscal} ${d.version.code_version} — Snapshot BCEAO`;
  titleCell.font = {
    name: 'Helvetica',
    bold: true,
    size: 16,
    color: { argb: BSIC_EXCEL_COLORS.blanc },
  };
  titleCell.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: BSIC_EXCEL_COLORS.bleuNuit },
  };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(1).height = 30;

  // Métadonnées workflow (lignes 3-10)
  const meta: Array<[string, string]> = [
    ['Code version', d.version.code_version],
    ['Libellé', d.version.libelle],
    [
      'Type',
      TYPE_VERSION_LIBELLES[d.version.type_version] ?? d.version.type_version,
    ],
    ['Exercice fiscal', String(d.version.exercice_fiscal)],
    ['Statut', d.version.statut],
    [
      `Soumise par`,
      `${d.version.utilisateur_soumission ?? '—'} (${fmtDateFr(d.version.date_soumission)})`,
    ],
    [
      'Validée par',
      `${d.version.utilisateur_validation ?? '—'} (${fmtDateFr(d.version.date_validation)})`,
    ],
    [
      'Publiée par',
      `${d.version.utilisateur_gel ?? '—'} (${fmtDateFr(d.version.date_gel)})`,
    ],
  ];
  for (let i = 0; i < meta.length; i++) {
    const row = ws.getRow(3 + i);
    const entry = meta[i];
    row.getCell(1).value = entry[0];
    row.getCell(2).value = entry[1];
    row.getCell(1).font = { bold: true, color: { argb: 'FF1B2A4E' } };
    row.getCell(2).font = { color: { argb: 'FF0F1B33' } };
  }

  // Chiffres clés (lignes 12-18)
  const kpi: Array<[string, number | string, string]> = [
    [
      'Total Produits (Classe 7)',
      d.totaux.total_produits,
      BSIC_EXCEL_COLORS.vertClair,
    ],
    [
      'Total Charges (Classe 6)',
      d.totaux.total_charges,
      BSIC_EXCEL_COLORS.orangeClair,
    ],
    [
      'Solde (P - C)',
      d.totaux.total_produits - d.totaux.total_charges,
      BSIC_EXCEL_COLORS.grisClair,
    ],
    ['Nombre de CR', d.totaux.nb_cr, BSIC_EXCEL_COLORS.grisClair],
    ['Nombre de comptes', d.totaux.nb_comptes, BSIC_EXCEL_COLORS.grisClair],
    ['Nombre de lignes', d.totaux.nb_lignes, BSIC_EXCEL_COLORS.grisClair],
    ['Devise pivot', 'XOF (FCFA UEMOA)', BSIC_EXCEL_COLORS.grisClair],
  ];
  for (let i = 0; i < kpi.length; i++) {
    const row = ws.getRow(12 + i);
    const entry = kpi[i];
    row.getCell(1).value = entry[0];
    row.getCell(2).value = entry[1];
    for (let c = 1; c <= 2; c++) {
      row.getCell(c).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: entry[2] },
      };
      row.getCell(c).font = { bold: c === 1, color: { argb: 'FF0F1B33' } };
    }
    if (typeof entry[1] === 'number') {
      row.getCell(2).numFmt = '#,##0';
    }
  }
}

// ─── Onglet 2 — Compte de résultat ───────────────────────────────────

function buildCompteResultatSheet(
  wb: ExcelJS.Workbook,
  d: R04Donnees,
  helper: ExcelBuilderService,
): void {
  const ws = wb.addWorksheet('Compte de résultat');
  ws.columns = [
    { header: 'Sous-classe', width: 14 },
    { header: 'Libellé', width: 45 },
    { header: 'Montant (FCFA)', width: 22 },
    { header: '% Total', width: 12 },
  ];
  helper.styleHeaderRow(ws.getRow(1));

  let rowIdx = 2;

  // Section A — Produits
  ws.mergeCells(`A${rowIdx}:D${rowIdx}`);
  const headerProd = ws.getRow(rowIdx);
  headerProd.getCell(1).value = 'A. PRODUITS (Classe 7)';
  headerProd.getCell(1).font = {
    bold: true,
    color: { argb: 'FF0F6E56' },
    size: 12,
  };
  headerProd.getCell(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: BSIC_EXCEL_COLORS.vertClair },
  };
  rowIdx++;

  const produits = d.comptedeResultat.filter((r) => r.classe === '7');
  for (const p of produits) {
    const r = ws.getRow(rowIdx++);
    r.getCell(1).value = p.sous_classe + 'xx';
    r.getCell(2).value = libelleSousClasse('7', p.sous_classe);
    r.getCell(3).value = p.montant;
    r.getCell(3).numFmt = '#,##0';
    r.getCell(4).value =
      d.totaux.total_produits === 0 ? 0 : p.montant / d.totaux.total_produits;
    r.getCell(4).numFmt = '0.0%';
  }
  const totalProd = ws.getRow(rowIdx++);
  totalProd.getCell(1).value = '';
  totalProd.getCell(2).value = 'Total Produits';
  totalProd.getCell(3).value = d.totaux.total_produits;
  totalProd.getCell(3).numFmt = '#,##0';
  totalProd.getCell(4).value = 1;
  totalProd.getCell(4).numFmt = '0.0%';
  helper.styleTotalRow(totalProd, { bg: BSIC_EXCEL_COLORS.vertClair });
  rowIdx++;

  // Section B — Charges
  ws.mergeCells(`A${rowIdx}:D${rowIdx}`);
  const headerCharges = ws.getRow(rowIdx);
  headerCharges.getCell(1).value = 'B. CHARGES (Classe 6)';
  headerCharges.getCell(1).font = {
    bold: true,
    color: { argb: 'FFE67E22' },
    size: 12,
  };
  headerCharges.getCell(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: BSIC_EXCEL_COLORS.orangeClair },
  };
  rowIdx++;

  const charges = d.comptedeResultat.filter((r) => r.classe === '6');
  for (const c of charges) {
    const r = ws.getRow(rowIdx++);
    r.getCell(1).value = c.sous_classe + 'xx';
    r.getCell(2).value = libelleSousClasse('6', c.sous_classe);
    r.getCell(3).value = c.montant;
    r.getCell(3).numFmt = '#,##0';
    r.getCell(4).value =
      d.totaux.total_charges === 0 ? 0 : c.montant / d.totaux.total_charges;
    r.getCell(4).numFmt = '0.0%';
  }
  const totalCharges = ws.getRow(rowIdx++);
  totalCharges.getCell(1).value = '';
  totalCharges.getCell(2).value = 'Total Charges';
  totalCharges.getCell(3).value = d.totaux.total_charges;
  totalCharges.getCell(3).numFmt = '#,##0';
  totalCharges.getCell(4).value = 1;
  totalCharges.getCell(4).numFmt = '0.0%';
  helper.styleTotalRow(totalCharges, { bg: BSIC_EXCEL_COLORS.orangeClair });
  rowIdx++;

  // Total général
  const totalGen = ws.getRow(rowIdx++);
  totalGen.getCell(1).value = '';
  totalGen.getCell(2).value = 'SOLDE (Produits - Charges)';
  totalGen.getCell(3).value = d.totaux.total_produits - d.totaux.total_charges;
  totalGen.getCell(3).numFmt = '#,##0';
  helper.styleTotalRow(totalGen, {
    bg: BSIC_EXCEL_COLORS.bleuNuit,
    color: BSIC_EXCEL_COLORS.blanc,
  });
}

// ─── Onglet 3 — Par CR ───────────────────────────────────────────────

function buildParCrSheet(
  wb: ExcelJS.Workbook,
  d: R04Donnees,
  helper: ExcelBuilderService,
): void {
  const ws = wb.addWorksheet('Par CR');
  ws.columns = [
    { header: 'Code', width: 18 },
    { header: 'Libellé', width: 38 },
    { header: 'Type', width: 22 },
    { header: 'Produits (FCFA)', width: 18 },
    { header: 'Charges (FCFA)', width: 18 },
    { header: 'Solde (FCFA)', width: 18 },
    { header: 'Poids %', width: 10 },
  ];
  helper.styleHeaderRow(ws.getRow(1));

  const totalActivite = d.totaux.total_produits + d.totaux.total_charges;
  let rowIdx = 2;

  for (const typeCr of ['cdc', 'cdr', 'cdp'] as const) {
    const lignes = d.ventilationCr.filter((c) => c.type_cr === typeCr);
    if (lignes.length === 0) continue;
    for (const c of lignes) {
      const r = ws.getRow(rowIdx++);
      r.getCell(1).value = c.code_cr;
      r.getCell(2).value = c.libelle;
      r.getCell(3).value = TYPE_CR_LIBELLES[c.type_cr] ?? c.type_cr;
      r.getCell(4).value = c.produits;
      r.getCell(5).value = c.charges;
      r.getCell(6).value = c.produits - c.charges;
      r.getCell(7).value =
        totalActivite === 0 ? 0 : (c.produits + c.charges) / totalActivite;
      r.getCell(4).numFmt = '#,##0';
      r.getCell(5).numFmt = '#,##0';
      r.getCell(6).numFmt = '#,##0';
      r.getCell(7).numFmt = '0.0%';
    }
    const subProd = lignes.reduce((s, l) => s + l.produits, 0);
    const subCh = lignes.reduce((s, l) => s + l.charges, 0);
    const subRow = ws.getRow(rowIdx++);
    subRow.getCell(2).value =
      `Sous-total ${TYPE_CR_LIBELLES[typeCr] ?? typeCr}`;
    subRow.getCell(4).value = subProd;
    subRow.getCell(5).value = subCh;
    subRow.getCell(6).value = subProd - subCh;
    subRow.getCell(7).value =
      totalActivite === 0 ? 0 : (subProd + subCh) / totalActivite;
    [4, 5, 6].forEach((c) => (subRow.getCell(c).numFmt = '#,##0'));
    subRow.getCell(7).numFmt = '0.0%';
    helper.styleTotalRow(subRow);
  }

  const totalRow = ws.getRow(rowIdx++);
  totalRow.getCell(2).value = 'TOTAL GÉNÉRAL';
  totalRow.getCell(4).value = d.totaux.total_produits;
  totalRow.getCell(5).value = d.totaux.total_charges;
  totalRow.getCell(6).value = d.totaux.total_produits - d.totaux.total_charges;
  totalRow.getCell(7).value = totalActivite === 0 ? 0 : 1;
  [4, 5, 6].forEach((c) => (totalRow.getCell(c).numFmt = '#,##0'));
  totalRow.getCell(7).numFmt = '0.0%';
  helper.styleTotalRow(totalRow, {
    bg: BSIC_EXCEL_COLORS.bleuNuit,
    color: BSIC_EXCEL_COLORS.blanc,
  });
}

// ─── Onglet 4 — Détail comptes ───────────────────────────────────────

function buildDetailComptesSheet(
  wb: ExcelJS.Workbook,
  d: R04Donnees,
  helper: ExcelBuilderService,
): void {
  const ws = wb.addWorksheet('Détail comptes');
  ws.columns = [
    { header: 'Code', width: 14 },
    { header: 'Libellé', width: 50 },
    { header: 'Classe', width: 10 },
    { header: 'Sens', width: 8 },
    { header: 'Montant (M FCFA)', width: 22 },
    { header: 'Montant (FCFA brut)', width: 22 },
  ];
  helper.styleHeaderRow(ws.getRow(1));
  ws.autoFilter = { from: 'A1', to: 'F1' };

  for (let i = 0; i < d.detailComptes.length; i++) {
    const c = d.detailComptes[i];
    const r = ws.getRow(2 + i);
    r.getCell(1).value = c.code_compte;
    r.getCell(2).value = c.libelle;
    r.getCell(3).value = c.classe;
    r.getCell(4).value = c.sens ?? '—';
    r.getCell(5).value = c.montant_total / 1_000_000;
    r.getCell(6).value = c.montant_total;
    r.getCell(5).numFmt = '#,##0';
    r.getCell(6).numFmt = '#,##0';

    // Bande de couleur par classe (6 = orange, 7 = vert).
    if (c.classe === '6') {
      helper.fillRow(r, BSIC_EXCEL_COLORS.orangeClair);
    } else if (c.classe === '7') {
      helper.fillRow(r, BSIC_EXCEL_COLORS.vertClair);
    }
  }
}

// ─── Onglet 5 — Audit trail ──────────────────────────────────────────

function buildAuditTrailSheet(
  wb: ExcelJS.Workbook,
  d: R04Donnees,
  helper: ExcelBuilderService,
): void {
  const ws = wb.addWorksheet('Audit trail');

  // En-tête (ligne fusionnée) en ligne 1
  ws.columns = [
    { width: 24 },
    { width: 22 },
    { width: 36 },
    { width: 50 },
    { width: 18 },
  ];
  ws.mergeCells('A1:E1');
  const title = ws.getCell('A1');
  title.value = `Cycle de validation du Budget ${d.version.exercice_fiscal} — Workflow E1→E2→E3`;
  title.font = {
    bold: true,
    size: 12,
    color: { argb: BSIC_EXCEL_COLORS.blanc },
  };
  title.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: BSIC_EXCEL_COLORS.bleuNuit },
  };
  title.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(1).height = 24;

  // Ligne 2 : en-têtes colonnes
  const header = ws.getRow(2);
  header.values = [
    'Étape',
    'Date / Heure',
    'Acteur',
    'Commentaire',
    'Référence audit_log',
  ];
  helper.styleHeaderRow(header);

  let rowIdx = 3;
  for (const a of d.auditTrail) {
    const r = ws.getRow(rowIdx++);
    r.getCell(1).value = formatActionLibelle(a.type_action);
    r.getCell(2).value = fmtDateFr(a.date_action);
    r.getCell(3).value = a.utilisateur;
    r.getCell(4).value = a.commentaire ?? '—';
    r.getCell(5).value = `#${a.id}`;
  }
  if (d.auditTrail.length === 0) {
    const r = ws.getRow(rowIdx);
    r.getCell(1).value = '—';
    r.getCell(2).value = '—';
    r.getCell(3).value = 'Aucune action workflow tracée';
    r.getCell(4).value = '(audit incomplet)';
    r.getCell(5).value = '—';
  }
}

function formatActionLibelle(typeAction: string): string {
  switch (typeAction) {
    case 'SOUMETTRE_BUDGET':
      return 'E1 — Soumission';
    case 'VALIDER_BUDGET':
      return 'E2 — Validation';
    case 'PUBLIER_BUDGET':
      return 'E3 — Publication (gel)';
    default:
      return typeAction;
  }
}

// ─── Orchestration ───────────────────────────────────────────────────

export function buildR04Xlsx(
  wb: ExcelJS.Workbook,
  donnees: R04Donnees,
  helper: ExcelBuilderService,
): void {
  buildSyntheseSheet(wb, donnees, helper);
  buildCompteResultatSheet(wb, donnees, helper);
  buildParCrSheet(wb, donnees, helper);
  buildDetailComptesSheet(wb, donnees, helper);
  buildAuditTrailSheet(wb, donnees, helper);
}
