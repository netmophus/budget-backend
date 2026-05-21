/**
 * Template PDF du rapport R04 "Budget Publié BCEAO" (Lot 7.6 — Palier 2).
 *
 * Structure 12 pages (les sauts longs peuvent générer 1-2 pages
 * supplémentaires selon la volumétrie réelle — la pagination dynamique
 * est gérée par pdfkit) :
 *
 *   1.  Page de garde
 *   2.  Traçabilité workflow (E1/E2/E3) + cachet BCEAO
 *   3.  Résumé exécutif (3 cards + tableau périmètre)
 *   4-5. Compte de résultat (PCB-UMOA — produits puis charges)
 *   6-7. Ventilation par CR (avec sous-totaux cdc/cdr/cdp)
 *   8-9. Détail par compte
 *   10. Audit trail chronologique
 *   11. Textes réglementaires
 *   12. Signatures + footer clôture
 *
 * Le template écrit directement dans le `doc` fourni par l'appelant
 * (service R04). Le footer paginé "Page X/N" est posé APRÈS par
 * `pdfBuilder.applyFooterToAllPages()`.
 */
import {
  BSIC_BRAND,
  type PdfBuilderService,
  type PdfTableColumn,
} from '../generators/pdf-builder.service';
import type {
  R04AuditEntry,
  R04Donnees,
  R04LigneCr,
} from '../services/r04-budget-bceao.service';

// ─── Mappings PCB-UMOA et libellés métier ────────────────────────────

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

// ─── Helpers formatage ───────────────────────────────────────────────

const fcfaFmt = new Intl.NumberFormat('fr-FR');

function fmtFcfa(n: number): string {
  return fcfaFmt.format(Math.round(n));
}

function fmtMillions(n: number): string {
  return fcfaFmt.format(Math.round(n / 1_000_000));
}

function fmtPct(n: number, total: number): string {
  if (total === 0) return '0,0 %';
  return `${((n * 100) / total).toFixed(1).replace('.', ',')} %`;
}

function fmtDateFrLong(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const months = [
    'janvier',
    'février',
    'mars',
    'avril',
    'mai',
    'juin',
    'juillet',
    'août',
    'septembre',
    'octobre',
    'novembre',
    'décembre',
  ];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()} ${String(
    d.getHours(),
  ).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} UTC`;
}

function fmtDateFrShort(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()} à ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function plusTenYears(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  d.setFullYear(d.getFullYear() + 10);
  const months = [
    'janvier',
    'février',
    'mars',
    'avril',
    'mai',
    'juin',
    'juillet',
    'août',
    'septembre',
    'octobre',
    'novembre',
    'décembre',
  ];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
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

function libelleSousClasse(classe: string, sousClasse: string): string {
  const map =
    classe === '7'
      ? PCB_LIBELLES_SOUS_CLASSE_PRODUITS
      : PCB_LIBELLES_SOUS_CLASSE_CHARGES;
  return map[sousClasse] ?? `Sous-classe ${sousClasse}`;
}

// ─── Page 1 — Garde ──────────────────────────────────────────────────

function drawPage1Garde(
  doc: PDFKit.PDFDocument,
  d: R04Donnees,
  pdf: PdfBuilderService,
): void {
  const pageW = doc.page.width;
  const left = BSIC_BRAND.marges.gauche;
  const right = pageW - BSIC_BRAND.marges.droite;
  const width = right - left;

  // Logo placeholder centré en haut
  pdf.drawLogoPlaceholder(doc, (pageW - 140) / 2, 60, 140, 50);

  // Gros titre
  doc
    .fillColor(BSIC_BRAND.colors.bleuNuit)
    .font(BSIC_BRAND.fonts.titre)
    .fontSize(26)
    .text(
      `BUDGET ${d.version.exercice_fiscal} — SNAPSHOT OFFICIEL`,
      left,
      150,
      { width, align: 'center' },
    );

  // Sous-titre
  doc
    .fillColor(BSIC_BRAND.colors.grisFonce)
    .font(BSIC_BRAND.fonts.body)
    .fontSize(11)
    .text(
      'BSIC NIGER S.A. — Banque Sahélo-Saharienne pour l’Investissement et le Commerce',
      left,
      doc.y + 8,
      { width, align: 'center' },
    );

  // Encadré métadonnées
  pdf.drawInfoBox(doc, left + 40, 270, width - 80, [
    { label: 'Code version', value: d.version.code_version },
    {
      label: 'Type',
      value:
        TYPE_VERSION_LIBELLES[d.version.type_version] ?? d.version.type_version,
    },
    {
      label: 'Exercice fiscal',
      value: String(d.version.exercice_fiscal),
    },
    {
      label: 'Date de publication',
      value: fmtDateFrLong(d.version.date_gel),
    },
    {
      label: 'Publié par',
      value: d.version.utilisateur_gel ?? '—',
    },
    {
      label: 'Conservation BCEAO',
      value: `jusqu'au ${plusTenYears(d.version.date_gel)}`,
    },
  ]);

  // Bas de page : confidentialité + référence document
  const today = new Date(d.version.date_gel ?? Date.now());
  const refDoc = `${d.version.code_version}_R04_BCEAO_${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
  doc
    .fillColor(BSIC_BRAND.colors.rouge)
    .font(BSIC_BRAND.fonts.titre)
    .fontSize(10)
    .text('CONFIDENTIEL — Usage réglementaire BCEAO', left, 700, {
      width,
      align: 'center',
    });
  doc
    .fillColor(BSIC_BRAND.colors.grisFonce)
    .font(BSIC_BRAND.fonts.body)
    .fontSize(8)
    .text(`Référence document : ${refDoc}`, left, doc.y + 6, {
      width,
      align: 'center',
    });
}

// ─── Page 2 — Traçabilité workflow ───────────────────────────────────

function drawPage2Audit(
  doc: PDFKit.PDFDocument,
  d: R04Donnees,
  pdf: PdfBuilderService,
): void {
  doc.addPage();
  pdf.drawSectionTitle(doc, 'I. TRAÇABILITÉ DU WORKFLOW DE VALIDATION');

  const cols: PdfTableColumn[] = [
    { header: 'Étape', width: 90 },
    { header: 'Date / Heure', width: 110 },
    { header: 'Acteur', width: 150 },
    { header: 'Commentaire', width: 145 },
  ];
  const rows = d.auditTrail.map((a) => [
    formatActionLibelle(a.type_action),
    fmtDateFrShort(a.date_action),
    a.utilisateur,
    a.commentaire ?? '—',
  ]);
  if (rows.length === 0) {
    rows.push(['—', '—', 'Aucune action workflow tracée', '(audit incomplet)']);
  }
  doc.x = BSIC_BRAND.marges.gauche;
  pdf.drawTable(doc, cols, rows, { rowHeight: 30 });

  // Cachet BCEAO en bas de page
  const lastAudit = d.auditTrail[d.auditTrail.length - 1];
  const refAudit = lastAudit ? `log #${lastAudit.id}` : 'log non disponible';
  pdf.drawBceaoStamp(
    doc,
    BSIC_BRAND.marges.gauche + 90,
    doc.page.height - 200,
    doc.page.width - BSIC_BRAND.marges.gauche - BSIC_BRAND.marges.droite - 180,
    refAudit,
  );
}

// ─── Page 3 — Résumé exécutif ────────────────────────────────────────

function drawPage3Resume(
  doc: PDFKit.PDFDocument,
  d: R04Donnees,
  pdf: PdfBuilderService,
): void {
  doc.addPage();
  pdf.drawSectionTitle(
    doc,
    `II. CHIFFRES CLÉS DU BUDGET ${d.version.exercice_fiscal}`,
  );

  // 3 cards côte à côte
  const left = BSIC_BRAND.marges.gauche;
  const right = doc.page.width - BSIC_BRAND.marges.droite;
  const cardW = (right - left - 20) / 3;
  const cardH = 90;
  const y = doc.y + 10;
  const solde = d.totaux.total_produits - d.totaux.total_charges;

  drawKpiCard(
    doc,
    left,
    y,
    cardW,
    cardH,
    'PRODUITS (Classe 7)',
    `${fmtMillions(d.totaux.total_produits)} M FCFA`,
    BSIC_BRAND.colors.vert,
  );
  drawKpiCard(
    doc,
    left + cardW + 10,
    y,
    cardW,
    cardH,
    'CHARGES (Classe 6)',
    `${fmtMillions(d.totaux.total_charges)} M FCFA`,
    BSIC_BRAND.colors.orange,
  );
  drawKpiCard(
    doc,
    left + 2 * (cardW + 10),
    y,
    cardW,
    cardH,
    'SOLDE',
    `${solde >= 0 ? '+' : ''}${fmtMillions(solde)} M FCFA`,
    solde >= 0 ? BSIC_BRAND.colors.vert : BSIC_BRAND.colors.rouge,
  );

  // Tableau Périmètre
  doc.y = y + cardH + 25;
  doc.x = left;
  doc
    .fillColor(BSIC_BRAND.colors.bleuNuitDark)
    .font(BSIC_BRAND.fonts.titre)
    .fontSize(11)
    .text('Périmètre du budget');
  doc.moveDown(0.4);
  pdf.drawTable(
    doc,
    [
      { header: 'Indicateur', width: 300 },
      { header: 'Valeur', width: 195, align: 'right' },
    ],
    [
      ['Nombre de Centres de Responsabilité', String(d.totaux.nb_cr)],
      ['Nombre de comptes saisis', String(d.totaux.nb_comptes)],
      ['Nombre de lignes budgétaires', fmtFcfa(d.totaux.nb_lignes)],
      ['Devise pivot', 'XOF (FCFA UEMOA)'],
    ],
  );
}

function drawKpiCard(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  value: string,
  color: string,
): void {
  doc
    .save()
    .lineWidth(1)
    .strokeColor(color)
    .fillColor('#FFFFFF')
    .roundedRect(x, y, w, h, 8)
    .fillAndStroke();
  doc
    .fillColor(BSIC_BRAND.colors.grisFonce)
    .font(BSIC_BRAND.fonts.body)
    .fontSize(9)
    .text(label, x + 10, y + 15, { width: w - 20, align: 'left' });
  doc
    .fillColor(color)
    .font(BSIC_BRAND.fonts.titre)
    .fontSize(18)
    .text(value, x + 10, y + 40, { width: w - 20, align: 'left' });
  doc.restore();
}

// ─── Pages 4-5 — Compte de résultat (produits + charges) ────────────

function drawCompteResultat(
  doc: PDFKit.PDFDocument,
  d: R04Donnees,
  pdf: PdfBuilderService,
): void {
  doc.addPage();
  pdf.drawSectionTitle(
    doc,
    `III. COMPTE DE RÉSULTAT PRÉVISIONNEL ${d.version.exercice_fiscal} (Format PCB-UMOA)`,
  );

  // A. PRODUITS
  doc.x = BSIC_BRAND.marges.gauche;
  doc
    .fillColor(BSIC_BRAND.colors.vert)
    .font(BSIC_BRAND.fonts.titre)
    .fontSize(12)
    .text('A. PRODUITS (Classe 7)');
  doc.moveDown(0.4);

  const produitsRows = d.comptedeResultat
    .filter((r) => r.classe === '7')
    .map((r) => [
      r.sous_classe + 'xx',
      libelleSousClasse('7', r.sous_classe),
      fmtMillions(r.montant),
      fmtPct(r.montant, d.totaux.total_produits),
    ]);

  pdf.drawTable(
    doc,
    [
      { header: 'Sous-classe', width: 75 },
      { header: 'Libellé', width: 245 },
      { header: 'Montant (M FCFA)', width: 100, align: 'right' },
      { header: '% Total', width: 75, align: 'right' },
    ],
    produitsRows.length > 0
      ? produitsRows
      : [['—', 'Aucune ligne produit', '0', '0,0 %']],
  );

  // Saut de page → B. CHARGES
  doc.addPage();
  pdf.drawSectionTitle(
    doc,
    `III. COMPTE DE RÉSULTAT PRÉVISIONNEL ${d.version.exercice_fiscal} (suite)`,
  );
  doc.x = BSIC_BRAND.marges.gauche;
  doc
    .fillColor(BSIC_BRAND.colors.orange)
    .font(BSIC_BRAND.fonts.titre)
    .fontSize(12)
    .text('B. CHARGES (Classe 6)');
  doc.moveDown(0.4);

  const chargesRows = d.comptedeResultat
    .filter((r) => r.classe === '6')
    .map((r) => [
      r.sous_classe + 'xx',
      libelleSousClasse('6', r.sous_classe),
      fmtMillions(r.montant),
      fmtPct(r.montant, d.totaux.total_charges),
    ]);

  pdf.drawTable(
    doc,
    [
      { header: 'Sous-classe', width: 75 },
      { header: 'Libellé', width: 245 },
      { header: 'Montant (M FCFA)', width: 100, align: 'right' },
      { header: '% Total', width: 75, align: 'right' },
    ],
    chargesRows.length > 0
      ? chargesRows
      : [['—', 'Aucune ligne charge', '0', '0,0 %']],
  );
}

// ─── Pages 6-7 — Ventilation par CR ──────────────────────────────────

function drawVentilationCr(
  doc: PDFKit.PDFDocument,
  d: R04Donnees,
  pdf: PdfBuilderService,
): void {
  doc.addPage();
  pdf.drawSectionTitle(doc, 'IV. VENTILATION PAR CENTRE DE RESPONSABILITÉ');

  const cols: PdfTableColumn[] = [
    { header: 'Code CR', width: 75 },
    { header: 'Libellé', width: 145 },
    { header: 'Type', width: 75 },
    { header: 'Produits (M)', width: 60, align: 'right' },
    { header: 'Charges (M)', width: 60, align: 'right' },
    { header: 'Solde (M)', width: 50, align: 'right' },
    { header: 'Poids %', width: 30, align: 'right' },
  ];

  const totalActivite = d.totaux.total_produits + d.totaux.total_charges;
  const ventByType = new Map<string, R04LigneCr[]>();
  for (const c of d.ventilationCr) {
    const arr = ventByType.get(c.type_cr) ?? [];
    arr.push(c);
    ventByType.set(c.type_cr, arr);
  }

  const rows: string[][] = [];
  for (const typeCr of ['cdc', 'cdr', 'cdp']) {
    const lignes = ventByType.get(typeCr) ?? [];
    if (lignes.length === 0) continue;
    for (const c of lignes) {
      const solde = c.produits - c.charges;
      const poids = c.produits + c.charges;
      rows.push([
        c.code_cr,
        c.libelle,
        TYPE_CR_LIBELLES[c.type_cr] ?? c.type_cr,
        fmtMillions(c.produits),
        fmtMillions(c.charges),
        fmtMillions(solde),
        fmtPct(poids, totalActivite),
      ]);
    }
    // Sous-total par type_cr
    const subProduits = lignes.reduce((s, l) => s + l.produits, 0);
    const subCharges = lignes.reduce((s, l) => s + l.charges, 0);
    rows.push([
      '',
      `Sous-total ${TYPE_CR_LIBELLES[typeCr] ?? typeCr}`,
      '',
      fmtMillions(subProduits),
      fmtMillions(subCharges),
      fmtMillions(subProduits - subCharges),
      fmtPct(subProduits + subCharges, totalActivite),
    ]);
  }

  // Total général
  rows.push([
    '',
    'TOTAL GÉNÉRAL',
    '',
    fmtMillions(d.totaux.total_produits),
    fmtMillions(d.totaux.total_charges),
    fmtMillions(d.totaux.total_produits - d.totaux.total_charges),
    '100,0 %',
  ]);

  doc.x = BSIC_BRAND.marges.gauche;
  pdf.drawTable(doc, cols, rows, { rowHeight: 18, fontSize: 8 });
}

// ─── Pages 8-9 — Détail par compte ───────────────────────────────────

function drawDetailComptes(
  doc: PDFKit.PDFDocument,
  d: R04Donnees,
  pdf: PdfBuilderService,
): void {
  doc.addPage();
  pdf.drawSectionTitle(doc, 'V. DÉTAIL PAR COMPTE COMPTABLE (PCB-UMOA)');

  const cols: PdfTableColumn[] = [
    { header: 'Code', width: 70 },
    { header: 'Libellé', width: 230 },
    { header: 'Classe', width: 50, align: 'center' },
    { header: 'Sens', width: 45, align: 'center' },
    { header: 'Montant (M FCFA)', width: 100, align: 'right' },
  ];
  const rows = d.detailComptes.map((c) => [
    c.code_compte,
    c.libelle,
    c.classe,
    c.sens ?? '—',
    fmtMillions(c.montant_total),
  ]);

  doc.x = BSIC_BRAND.marges.gauche;
  pdf.drawTable(doc, cols, rows, { rowHeight: 18, fontSize: 8 });
}

// ─── Page 10 — Audit trail chronologique ─────────────────────────────

function drawAuditTrail(
  doc: PDFKit.PDFDocument,
  d: R04Donnees,
  pdf: PdfBuilderService,
): void {
  doc.addPage();
  pdf.drawSectionTitle(
    doc,
    "VI. JOURNAL D'AUDIT — TRAÇABILITÉ DES TRANSITIONS",
  );

  const left = BSIC_BRAND.marges.gauche;
  doc.x = left;
  for (const a of d.auditTrail) {
    drawAuditEntry(doc, a);
    doc.moveDown(0.6);
  }
  if (d.auditTrail.length === 0) {
    doc
      .fillColor(BSIC_BRAND.colors.grisFonce)
      .font(BSIC_BRAND.fonts.italic)
      .fontSize(10)
      .text('Aucune action workflow tracée pour ce cycle de publication.');
  }

  doc.moveDown(1);
  doc
    .fillColor(BSIC_BRAND.colors.grisFonce)
    .font(BSIC_BRAND.fonts.italic)
    .fontSize(9)
    .text(
      'Ces enregistrements sont immuables et conservés 10 ans conformément aux exigences BCEAO.',
      { align: 'left' },
    );
}

function drawAuditEntry(doc: PDFKit.PDFDocument, a: R04AuditEntry): void {
  doc
    .fillColor(BSIC_BRAND.colors.bleuNuit)
    .font(BSIC_BRAND.fonts.titre)
    .fontSize(10)
    .text(`[${fmtDateFrShort(a.date_action)}] ${a.type_action}`);
  doc
    .fillColor(BSIC_BRAND.colors.bleuNuitDark)
    .font(BSIC_BRAND.fonts.body)
    .fontSize(9);
  doc.text(`  Acteur     : ${a.utilisateur}`);
  doc.text(`  Référence  : audit_log #${a.id}`);
  doc.text(`  Commentaire : ${a.commentaire ?? '—'}`);
}

// ─── Page 11 — Textes réglementaires ─────────────────────────────────

function drawTextesReglementaires(
  doc: PDFKit.PDFDocument,
  pdf: PdfBuilderService,
): void {
  doc.addPage();
  pdf.drawSectionTitle(doc, 'VII. CONFORMITÉ RÉGLEMENTAIRE');

  const textes: Array<[string, string]> = [
    ['Décision BCEAO N°357-11-2016', 'Plan Comptable Bancaire UMOA Révisé'],
    [
      'Instruction N°026-11-2016',
      'Tenue de la comptabilité des établissements de crédit',
    ],
    [
      'Circulaire N°005-2017/CB/C',
      'Dispositif de contrôle interne des établissements de crédit',
    ],
    ['Circulaire N°004-2017/CB/C', 'Gouvernance des établissements de crédit'],
    [
      'Avis N°004-2016/CB',
      'Normes prudentielles applicables aux établissements de crédit',
    ],
  ];

  for (const [ref, libelle] of textes) {
    doc
      .fillColor(BSIC_BRAND.colors.bleuNuit)
      .font(BSIC_BRAND.fonts.titre)
      .fontSize(10)
      .text(`• ${ref}`, { continued: true })
      .fillColor(BSIC_BRAND.colors.bleuNuitDark)
      .font(BSIC_BRAND.fonts.body)
      .fontSize(10)
      .text(` — ${libelle}`);
    doc.moveDown(0.3);
  }

  doc.moveDown(0.8);
  doc
    .fillColor(BSIC_BRAND.colors.grisFonce)
    .font(BSIC_BRAND.fonts.italic)
    .fontSize(10)
    .text(
      "Le présent budget a été élaboré conformément au Plan Comptable Bancaire UMOA Révisé et respecte les principes de séparation des tâches, de traçabilité et de conservation décennale exigés par la BCEAO. L'ensemble des actions de saisie, validation et publication ont été enregistrées dans le journal d'audit MIZNAS et sont consultables par les organes de contrôle interne (Audit, Risques, Conformité).",
      { align: 'justify', lineGap: 3 },
    );
}

// ─── Page 12 — Signatures et clôture ─────────────────────────────────

function drawSignatures(
  doc: PDFKit.PDFDocument,
  d: R04Donnees,
  pdf: PdfBuilderService,
): void {
  doc.addPage();
  pdf.drawSectionTitle(doc, 'VIII. SIGNATURES');

  const left = BSIC_BRAND.marges.gauche;
  const right = doc.page.width - BSIC_BRAND.marges.droite;
  const blocW = (right - left - 30) / 2;
  const y = doc.y + 20;

  drawSignatureBlock(
    doc,
    left,
    y,
    blocW,
    'Le Directeur Général',
    d.version.utilisateur_gel,
    'Date publication MIZNAS',
    d.version.date_gel,
    d.auditTrail.find((a) => a.type_action === 'PUBLIER_BUDGET')?.id,
  );
  drawSignatureBlock(
    doc,
    left + blocW + 30,
    y,
    blocW,
    "Le Président du Conseil d'Administration",
    d.version.utilisateur_validation,
    'Date validation comité collégial',
    d.version.date_validation,
    d.auditTrail.find((a) => a.type_action === 'VALIDER_BUDGET')?.id,
  );

  // Footer clôture (au-dessus du footer paginé)
  const footerY = doc.page.height - 130;
  doc
    .save()
    .lineWidth(0.5)
    .strokeColor(BSIC_BRAND.colors.grisFonce)
    .moveTo(left, footerY)
    .lineTo(right, footerY)
    .stroke()
    .restore();

  const today = new Date(d.version.date_gel ?? Date.now());
  const refDoc = `${d.version.code_version}_R04_BCEAO_${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
  doc
    .fillColor(BSIC_BRAND.colors.grisFonce)
    .font(BSIC_BRAND.fonts.italic)
    .fontSize(8)
    .text(
      `Document généré automatiquement par MIZNAS le ${fmtDateFrLong(d.version.date_gel)}`,
      left,
      footerY + 8,
      { width: right - left, align: 'center' },
    );
  doc.text(`Référence : ${refDoc}`, left, doc.y + 2, {
    width: right - left,
    align: 'center',
  });
  doc.text('Conservation 10 ans BCEAO — Confidentiel', left, doc.y + 2, {
    width: right - left,
    align: 'center',
  });
}

function drawSignatureBlock(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  w: number,
  role: string,
  utilisateur: string | null,
  dateLabel: string,
  date: string | null,
  auditId: string | undefined,
): void {
  doc
    .fillColor(BSIC_BRAND.colors.bleuNuit)
    .font(BSIC_BRAND.fonts.titre)
    .fontSize(11)
    .text(role, x, y, { width: w });
  doc.moveDown(2.5);
  doc
    .fillColor(BSIC_BRAND.colors.bleuNuitDark)
    .font(BSIC_BRAND.fonts.titre)
    .fontSize(10)
    .text(utilisateur ?? '—', x, doc.y, { width: w });
  doc
    .fillColor(BSIC_BRAND.colors.grisFonce)
    .font(BSIC_BRAND.fonts.body)
    .fontSize(9)
    .text(dateLabel, x, doc.y + 4, { width: w });
  doc.text(fmtDateFrLong(date), x, doc.y, { width: w });
  doc.moveDown(1);
  doc
    .fillColor(BSIC_BRAND.colors.or)
    .font(BSIC_BRAND.fonts.italic)
    .fontSize(9)
    .text(`[Cachet électronique : audit_log #${auditId ?? '—'}]`, x, doc.y, {
      width: w,
    });
}

// ─── Orchestration ───────────────────────────────────────────────────

export function buildR04Pdf(
  doc: PDFKit.PDFDocument,
  donnees: R04Donnees,
  pdf: PdfBuilderService,
): void {
  drawPage1Garde(doc, donnees, pdf);
  drawPage2Audit(doc, donnees, pdf);
  drawPage3Resume(doc, donnees, pdf);
  drawCompteResultat(doc, donnees, pdf);
  drawVentilationCr(doc, donnees, pdf);
  drawDetailComptes(doc, donnees, pdf);
  drawAuditTrail(doc, donnees, pdf);
  drawTextesReglementaires(doc, pdf);
  drawSignatures(doc, donnees, pdf);
}
