/**
 * Template PDF du rapport « Analyse Budget vs Réalisé »
 * (Lot 8.6.B). Pattern aligné sur R04 BCEAO du Lot 7.6 :
 * fonction `buildTableauBordAnalysePdf(doc, data, pdfBuilder)`
 * qui écrit directement dans le doc fourni par le service.
 *
 * Structure 3 pages (4 si analyse IA présente) :
 *   1. En-tête + metadata + KPI 2x2
 *   2. Graphiques agrégés (bar chart mensuel + donut niveaux)
 *   3. Top 10 écarts (tableau)
 *   4. Analyse MIZNAS AI (markdown rendu) — conditionnelle
 *
 * Les graphiques (bar chart + donut + top 10) sont dessinés en
 * primitives pdfkit natives (rect, arc, lignes). Aucune
 * dépendance image (cohérent avec R04).
 */
import {
  BSIC_BRAND,
  formatMontant,
  type PdfBuilderService,
} from '../../reporting/generators/pdf-builder.service';
import type {
  EcartsResponseDto,
  LigneEcartDto,
  NiveauAlerte,
} from '../dto/tableau-bord.dto';
import { renderMarkdown } from './markdown-to-pdf';

/**
 * Snapshot d'analyse IA inclus dans le PDF si présent. Miroir du
 * type frontend `AnalyseAiResponse` (Lot 8.6.A) — le service le
 * récupère via le body POST de l'endpoint export-pdf.
 */
export interface AnalyseAiSnapshot {
  analyse: string;
  model: string;
  tokensInput: number;
  tokensOutput: number;
  dureeMs: number;
  dryRun: boolean;
  /** ISO 8601, optionnel — affiché dans le footer de la page IA. */
  generatedAt?: string;
}

export interface TableauBordAnalyseData {
  ecarts: EcartsResponseDto;
  metadata: {
    codeVersion: string;
    codeScenario: string;
    crsLibelles: string[]; // [] = "Tous les CR"
    userEmail: string;
    /** ISO de génération du PDF — utilisé partout pour cohérence. */
    generatedAt: string;
  };
  analyseIa?: AnalyseAiSnapshot;
}

/** Couleurs niveaux d'alerte — alignées sur le frontend (Lot 8.5.C). */
const COULEURS_NIVEAU: Record<NiveauAlerte, string> = {
  CRITIQUE: '#DC2626',
  ATTENTION: '#BA7517',
  NORMAL: '#0F6E56',
  MANQUANT: '#5F6B7A',
};

const LIBELLES_NIVEAU: Record<NiveauAlerte, string> = {
  CRITIQUE: 'Critique',
  ATTENTION: 'Attention',
  NORMAL: 'Normal',
  MANQUANT: 'Manquant',
};

const NIVEAUX_ORDONNES: NiveauAlerte[] = [
  'CRITIQUE',
  'ATTENTION',
  'MANQUANT',
  'NORMAL',
];

const MOIS_FR = [
  'Jan',
  'Fév',
  'Mar',
  'Avr',
  'Mai',
  'Juin',
  'Juil',
  'Aoû',
  'Sep',
  'Oct',
  'Nov',
  'Déc',
];

function formaterDateFr(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${String(d.getFullYear())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

// ─── Point d'entrée principal ──────────────────────────────────────

export function buildTableauBordAnalysePdf(
  doc: PDFKit.PDFDocument,
  data: TableauBordAnalyseData,
  pdfBuilder: PdfBuilderService,
): void {
  // Page 1 — en-tête + métadonnées + KPI
  renderPage1HeaderEtKpi(doc, data, pdfBuilder);
  // Page 2 — bar chart mensuel + donut niveaux
  doc.addPage();
  renderPage2Graphiques(doc, data);
  // Page 3 — top 10 écarts (tableau)
  doc.addPage();
  renderPage3Top10(doc, data, pdfBuilder);
  // Page 4 — analyse MIZNAS AI (optionnelle)
  if (data.analyseIa) {
    doc.addPage();
    renderPage4AnalyseIa(doc, data.analyseIa);
  }
}

// ─── Page 1 — Header + KPI ─────────────────────────────────────────

function renderPage1HeaderEtKpi(
  doc: PDFKit.PDFDocument,
  data: TableauBordAnalyseData,
  pdfBuilder: PdfBuilderService,
): void {
  const widthDispo =
    doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const left = doc.page.margins.left;
  let y = doc.page.margins.top;

  // Titre principal
  doc
    .fillColor(BSIC_BRAND.colors.bleuNuit)
    .font(BSIC_BRAND.fonts.titre)
    .fontSize(BSIC_BRAND.fontSizes.section + 4)
    .text('ANALYSE BUDGET vs RÉALISÉ', left, y, {
      width: widthDispo,
      align: 'center',
      lineBreak: false,
    });
  y += 28;

  // Sous-titre période
  doc
    .fillColor(BSIC_BRAND.colors.grisFonce)
    .font(BSIC_BRAND.fonts.body)
    .fontSize(BSIC_BRAND.fontSizes.body + 1)
    .text(
      `Période : ${data.ecarts.filtres.moisDebut} → ${data.ecarts.filtres.moisFin}`,
      left,
      y,
      { width: widthDispo, align: 'center', lineBreak: false },
    );
  y += 22;

  // Encadré metadata (drawInfoBox helper Lot 7.6)
  doc.y = y;
  pdfBuilder.drawInfoBox(doc, left, y, widthDispo, [
    { label: 'Version', value: data.metadata.codeVersion },
    { label: 'Scénario', value: data.metadata.codeScenario },
    {
      label: 'Centres de responsabilité',
      value:
        data.metadata.crsLibelles.length === 0
          ? 'Tous les CR du périmètre utilisateur'
          : data.metadata.crsLibelles.join(', '),
    },
    {
      label: 'Seuil ATTENTION',
      value: `≥ ${String(data.ecarts.filtres.seuilEcartPctAttention ?? 5)} %`,
    },
    {
      label: 'Seuil CRITIQUE',
      value: `≥ ${String(data.ecarts.filtres.seuilEcartPctCritique ?? 10)} %`,
    },
    {
      label: 'Généré le',
      value: formaterDateFr(data.metadata.generatedAt),
    },
    { label: 'Par', value: data.metadata.userEmail },
  ]);
  y += 7 * 18 + 20 + 14; // padding + nb rows*18 + après encadré

  // Section KPI
  doc
    .fillColor(BSIC_BRAND.colors.bleuNuit)
    .font(BSIC_BRAND.fonts.titre)
    .fontSize(BSIC_BRAND.fontSizes.section)
    .text('INDICATEURS CLÉS', left, y, {
      width: widthDispo,
      lineBreak: false,
    });
  y += 24;

  // 4 cards 2x2
  const cardW = (widthDispo - 12) / 2;
  const cardH = 70;
  const k = data.ecarts.kpi;
  drawKpiCard(
    doc,
    left,
    y,
    cardW,
    cardH,
    'Lignes avec écart',
    String(k.nbEcartsTotal),
    BSIC_BRAND.colors.bleuNuit,
  );
  drawKpiCard(
    doc,
    left + cardW + 12,
    y,
    cardW,
    cardH,
    'Niveau CRITIQUE',
    String(k.nbEcartsCritique),
    COULEURS_NIVEAU.CRITIQUE,
  );
  y += cardH + 12;
  drawKpiCard(
    doc,
    left,
    y,
    cardW,
    cardH,
    'Niveau ATTENTION',
    String(k.nbEcartsAttention),
    COULEURS_NIVEAU.ATTENTION,
  );
  drawKpiCard(
    doc,
    left + cardW + 12,
    y,
    cardW,
    cardH,
    'Écart total absolu (FCFA)',
    formatMontant(k.ecartTotalAbs),
    BSIC_BRAND.colors.bleuNuit,
  );
  y += cardH + 18;

  // Décomposition défavorable / favorable sous les KPI
  doc
    .fillColor(BSIC_BRAND.colors.grisFonce)
    .font(BSIC_BRAND.fonts.body)
    .fontSize(BSIC_BRAND.fontSizes.bodySmall)
    .text(
      `Dont défavorable : ${formatMontant(k.ecartTotalDefavorable)} FCFA  ·  ` +
        `Dont favorable : ${formatMontant(k.ecartTotalFavorable)} FCFA  ·  ` +
        `Lignes sans réalisé : ${String(k.nbLignesManquantes)}`,
      left,
      y,
      { width: widthDispo, align: 'center', lineBreak: false },
    );
}

function drawKpiCard(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  width: number,
  height: number,
  label: string,
  valeur: string,
  couleurAccent: string,
): void {
  doc.save();
  // Cadre
  doc
    .lineWidth(0.7)
    .strokeColor(BSIC_BRAND.colors.grisFonce)
    .fillColor(BSIC_BRAND.colors.blanc)
    .rect(x, y, width, height)
    .fillAndStroke();
  // Barre verticale gauche couleur accent
  doc.fillColor(couleurAccent).rect(x, y, 4, height).fill();
  // Label
  doc
    .fillColor(BSIC_BRAND.colors.grisFonce)
    .font(BSIC_BRAND.fonts.body)
    .fontSize(BSIC_BRAND.fontSizes.bodySmall)
    .text(label.toUpperCase(), x + 12, y + 10, {
      width: width - 16,
      lineBreak: false,
    });
  // Valeur
  doc
    .fillColor(couleurAccent)
    .font(BSIC_BRAND.fonts.titre)
    .fontSize(BSIC_BRAND.fontSizes.section + 6)
    .text(valeur, x + 12, y + 30, {
      width: width - 16,
      lineBreak: false,
    });
  doc.restore();
}

// ─── Page 2 — Graphiques ───────────────────────────────────────────

function renderPage2Graphiques(
  doc: PDFKit.PDFDocument,
  data: TableauBordAnalyseData,
): void {
  const widthDispo =
    doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const left = doc.page.margins.left;
  let y = doc.page.margins.top;

  // Titre section
  doc
    .fillColor(BSIC_BRAND.colors.bleuNuit)
    .font(BSIC_BRAND.fonts.titre)
    .fontSize(BSIC_BRAND.fontSizes.section)
    .text('ÉVOLUTION MENSUELLE ET RÉPARTITION', left, y, {
      width: widthDispo,
      lineBreak: false,
    });
  y += 30;

  // Bar chart mensuel — moitié haute
  const barHeight = 230;
  drawBarChartMensuel(doc, left, y, widthDispo, barHeight, data.ecarts.lignes);
  y += barHeight + 30;

  // Donut niveaux — moitié basse
  drawDonutNiveaux(doc, left, y, widthDispo, 230, data.ecarts.lignes);
}

interface PointMensuel {
  mois: string;
  libelleMois: string;
  budget: number;
  realise: number;
}

function aggregerParMois(lignes: LigneEcartDto[]): PointMensuel[] {
  const acc = new Map<string, PointMensuel>();
  for (const l of lignes) {
    const existing = acc.get(l.mois);
    if (existing) {
      existing.budget += l.montantBudget;
      existing.realise += l.montantRealise ?? 0;
    } else {
      acc.set(l.mois, {
        mois: l.mois,
        libelleMois: l.libelleMois,
        budget: l.montantBudget,
        realise: l.montantRealise ?? 0,
      });
    }
  }
  return [...acc.values()].sort((a, b) => a.mois.localeCompare(b.mois));
}

function formatFcfaCompact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(1)} Md`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(0)} M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(0)} K`;
  return String(Math.round(n));
}

function drawBarChartMensuel(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  width: number,
  height: number,
  lignes: LigneEcartDto[],
): void {
  const data = aggregerParMois(lignes);
  // Titre + légende
  doc
    .fillColor(BSIC_BRAND.colors.bleuNuitDark)
    .font(BSIC_BRAND.fonts.titre)
    .fontSize(BSIC_BRAND.fontSizes.body)
    .text('Budget vs Réalisé par mois', x, y, { lineBreak: false });
  // Légende (carrés colorés + texte)
  doc
    .save()
    .fillColor(BSIC_BRAND.colors.bleuNuit)
    .rect(x + width - 150, y + 2, 8, 8)
    .fill()
    .restore();
  doc
    .fillColor(BSIC_BRAND.colors.grisFonce)
    .font(BSIC_BRAND.fonts.body)
    .fontSize(BSIC_BRAND.fontSizes.bodySmall)
    .text('Budget', x + width - 138, y + 2, { lineBreak: false });
  doc
    .save()
    .fillColor(BSIC_BRAND.colors.or)
    .rect(x + width - 90, y + 2, 8, 8)
    .fill()
    .restore();
  doc
    .fillColor(BSIC_BRAND.colors.grisFonce)
    .text('Réalisé', x + width - 78, y + 2, { lineBreak: false });

  const chartY = y + 22;
  const chartH = height - 42;
  const chartX = x + 50; // place pour axe Y libellés
  const chartW = width - 60;

  if (data.length === 0) {
    doc
      .fillColor(BSIC_BRAND.colors.grisFonce)
      .font(BSIC_BRAND.fonts.italic)
      .fontSize(BSIC_BRAND.fontSizes.bodySmall)
      .text(
        'Aucune ligne à représenter sur la période.',
        x,
        chartY + chartH / 2 - 6,
        { width, align: 'center', lineBreak: false },
      );
    return;
  }

  // Max pour échelle
  const maxValue = Math.max(1, ...data.flatMap((d) => [d.budget, d.realise]));
  const niceMax = roundedNiceMax(maxValue);

  // Lignes de grille horizontales (5 graduations)
  doc.save();
  doc.strokeColor('#E5E7EB').lineWidth(0.5);
  for (let i = 0; i <= 4; i++) {
    const gy = chartY + chartH - (i / 4) * chartH;
    doc
      .moveTo(chartX, gy)
      .lineTo(chartX + chartW, gy)
      .stroke();
    // Label axe Y
    doc
      .fillColor(BSIC_BRAND.colors.grisFonce)
      .font(BSIC_BRAND.fonts.body)
      .fontSize(BSIC_BRAND.fontSizes.bodySmall - 1)
      .text(formatFcfaCompact((i / 4) * niceMax), x, gy - 4, {
        width: 46,
        align: 'right',
        lineBreak: false,
      });
  }
  doc.restore();

  // Barres (groupes Budget + Réalisé par mois)
  const nbMois = data.length;
  const groupWidth = chartW / nbMois;
  const barWidth = Math.min(18, (groupWidth - 8) / 2);
  for (let i = 0; i < data.length; i++) {
    const m = data[i];
    const groupX =
      chartX + i * groupWidth + (groupWidth - 2 * barWidth - 2) / 2;
    const hBudget = (m.budget / niceMax) * chartH;
    const hRealise = (m.realise / niceMax) * chartH;
    doc
      .save()
      .fillColor(BSIC_BRAND.colors.bleuNuit)
      .rect(groupX, chartY + chartH - hBudget, barWidth, hBudget)
      .fill()
      .restore();
    doc
      .save()
      .fillColor(BSIC_BRAND.colors.or)
      .rect(
        groupX + barWidth + 2,
        chartY + chartH - hRealise,
        barWidth,
        hRealise,
      )
      .fill()
      .restore();
    // Label axe X (mois — abrégé)
    const labelMois = m.libelleMois.split(' ')[0]?.slice(0, 3) ?? m.mois;
    doc
      .fillColor(BSIC_BRAND.colors.grisFonce)
      .font(BSIC_BRAND.fonts.body)
      .fontSize(BSIC_BRAND.fontSizes.bodySmall - 1)
      .text(labelMois, chartX + i * groupWidth, chartY + chartH + 4, {
        width: groupWidth,
        align: 'center',
        lineBreak: false,
      });
  }
}

function roundedNiceMax(maxValue: number): number {
  if (maxValue <= 0) return 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(maxValue)));
  const normalized = maxValue / magnitude;
  let niceNorm: number;
  if (normalized <= 1) niceNorm = 1;
  else if (normalized <= 2) niceNorm = 2;
  else if (normalized <= 5) niceNorm = 5;
  else niceNorm = 10;
  return niceNorm * magnitude;
}

interface PointNiveau {
  niveau: NiveauAlerte;
  count: number;
  pct: number;
}

function drawDonutNiveaux(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  width: number,
  height: number,
  lignes: LigneEcartDto[],
): void {
  // Titre
  doc
    .fillColor(BSIC_BRAND.colors.bleuNuitDark)
    .font(BSIC_BRAND.fonts.titre)
    .fontSize(BSIC_BRAND.fontSizes.body)
    .text("Répartition par niveau d'alerte", x, y, { lineBreak: false });

  const counts: Record<NiveauAlerte, number> = {
    CRITIQUE: 0,
    ATTENTION: 0,
    MANQUANT: 0,
    NORMAL: 0,
  };
  for (const l of lignes) counts[l.niveauAlerte]++;
  const total = lignes.length;
  const points: PointNiveau[] = NIVEAUX_ORDONNES.map((n) => ({
    niveau: n,
    count: counts[n],
    pct: total === 0 ? 0 : Math.round((counts[n] / total) * 1000) / 10,
  }));

  // Géométrie : donut à gauche, légende à droite.
  const donutY = y + 24;
  const donutH = height - 30;
  const cx = x + donutH / 2 + 10;
  const cy = donutY + donutH / 2;
  const rOuter = Math.min(donutH / 2 - 4, 80);
  const rInner = rOuter * 0.55;

  if (total === 0) {
    doc
      .fillColor(BSIC_BRAND.colors.grisFonce)
      .font(BSIC_BRAND.fonts.italic)
      .fontSize(BSIC_BRAND.fontSizes.bodySmall)
      .text('Aucune ligne à représenter.', x, donutY + donutH / 2 - 6, {
        width,
        align: 'center',
        lineBreak: false,
      });
    return;
  }

  // Segments — somme cumulative pour la position angulaire.
  let cumul = 0;
  for (const p of points) {
    if (p.count === 0) continue;
    const startAngle = (cumul / total) * 2 * Math.PI - Math.PI / 2;
    cumul += p.count;
    const endAngle = (cumul / total) * 2 * Math.PI - Math.PI / 2;
    drawDonutSegment(
      doc,
      cx,
      cy,
      rOuter,
      rInner,
      startAngle,
      endAngle,
      COULEURS_NIVEAU[p.niveau],
    );
  }

  // Total centré
  doc
    .fillColor(BSIC_BRAND.colors.bleuNuitDark)
    .font(BSIC_BRAND.fonts.titre)
    .fontSize(BSIC_BRAND.fontSizes.section)
    .text(String(total), cx - 30, cy - 10, {
      width: 60,
      align: 'center',
      lineBreak: false,
    });
  doc
    .fillColor(BSIC_BRAND.colors.grisFonce)
    .font(BSIC_BRAND.fonts.body)
    .fontSize(BSIC_BRAND.fontSizes.bodySmall)
    .text('lignes', cx - 30, cy + 14, {
      width: 60,
      align: 'center',
      lineBreak: false,
    });

  // Légende à droite
  const legX = cx + rOuter + 30;
  let legY = donutY + 4;
  for (const p of points) {
    doc
      .save()
      .fillColor(COULEURS_NIVEAU[p.niveau])
      .rect(legX, legY + 2, 10, 10)
      .fill()
      .restore();
    doc
      .fillColor(BSIC_BRAND.colors.bleuNuitDark)
      .font(BSIC_BRAND.fonts.body)
      .fontSize(BSIC_BRAND.fontSizes.bodySmall)
      .text(
        `${LIBELLES_NIVEAU[p.niveau]} — ${String(p.count)} (${p.pct.toFixed(1)} %)`,
        legX + 16,
        legY,
        { width: 200, lineBreak: false },
      );
    legY += 22;
  }
}

/**
 * Dessine un segment de donut entre 2 angles via un path composé :
 * arc extérieur (sens horaire), ligne vers l'arc intérieur, arc
 * intérieur (sens trigo), close. Polyligne 32 points par arc pour
 * un rendu lisse sans dépendre de `bezierCurveTo`.
 */
function drawDonutSegment(
  doc: PDFKit.PDFDocument,
  cx: number,
  cy: number,
  rOuter: number,
  rInner: number,
  startAngle: number,
  endAngle: number,
  fill: string,
): void {
  const steps = 32;
  doc.save().fillColor(fill);
  // Arc extérieur du startAngle vers endAngle
  for (let i = 0; i <= steps; i++) {
    const t = startAngle + ((endAngle - startAngle) * i) / steps;
    const px = cx + rOuter * Math.cos(t);
    const py = cy + rOuter * Math.sin(t);
    if (i === 0) doc.moveTo(px, py);
    else doc.lineTo(px, py);
  }
  // Arc intérieur du endAngle vers startAngle
  for (let i = 0; i <= steps; i++) {
    const t = endAngle - ((endAngle - startAngle) * i) / steps;
    const px = cx + rInner * Math.cos(t);
    const py = cy + rInner * Math.sin(t);
    doc.lineTo(px, py);
  }
  doc.closePath().fill().restore();
  // libelle MOIS_FR non utilisé ici — silence linter via référence neutre.
  void MOIS_FR;
}

// ─── Page 3 — Top 10 écarts ─────────────────────────────────────────

function renderPage3Top10(
  doc: PDFKit.PDFDocument,
  data: TableauBordAnalyseData,
  pdfBuilder: PdfBuilderService,
): void {
  const widthDispo =
    doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const left = doc.page.margins.left;
  const y = doc.page.margins.top;

  doc
    .fillColor(BSIC_BRAND.colors.bleuNuit)
    .font(BSIC_BRAND.fonts.titre)
    .fontSize(BSIC_BRAND.fontSizes.section)
    .text('TOP 10 ÉCARTS LES PLUS SIGNIFICATIFS', left, y, {
      width: widthDispo,
      lineBreak: false,
    });
  doc
    .fillColor(BSIC_BRAND.colors.grisFonce)
    .font(BSIC_BRAND.fonts.italic)
    .fontSize(BSIC_BRAND.fontSizes.bodySmall)
    .text(
      'Lignes avec réalisé saisi (MANQUANT exclu), triées par écart absolu décroissant.',
      left,
      y + 22,
      { width: widthDispo, lineBreak: false },
    );

  const top = [...data.ecarts.lignes]
    .filter(
      (l): l is LigneEcartDto & { ecartAbs: number } => l.ecartAbs !== null,
    )
    .sort((a, b) => b.ecartAbs - a.ecartAbs)
    .slice(0, 10);

  doc.y = y + 50;
  doc.x = left;

  if (top.length === 0) {
    doc
      .fillColor(BSIC_BRAND.colors.grisFonce)
      .font(BSIC_BRAND.fonts.italic)
      .fontSize(BSIC_BRAND.fontSizes.body)
      .text('Aucune ligne avec écart à représenter.', { width: widthDispo });
    return;
  }

  const rows = top.map((l, i) => [
    String(i + 1),
    l.codeCompte,
    l.libelleCompte.length > 30
      ? `${l.libelleCompte.slice(0, 29)}…`
      : l.libelleCompte,
    l.codeCr,
    l.libelleMois,
    `${formatMontant(l.ecartAbs)} FCFA`,
    LIBELLES_NIVEAU[l.niveauAlerte],
  ]);

  pdfBuilder.drawTable(
    doc,
    [
      { header: '#', width: 24, align: 'center' },
      { header: 'Compte', width: 56 },
      { header: 'Libellé', width: 160 },
      { header: 'CR', width: 90 },
      { header: 'Mois', width: 70 },
      { header: 'Écart abs.', width: 90, align: 'right' },
      { header: 'Niveau', width: 60, align: 'center' },
    ],
    rows,
  );
}

// ─── Page 4 — Analyse IA (conditionnelle) ──────────────────────────

function renderPage4AnalyseIa(
  doc: PDFKit.PDFDocument,
  ia: AnalyseAiSnapshot,
): void {
  const widthDispo =
    doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const left = doc.page.margins.left;
  let y = doc.page.margins.top;

  doc
    .fillColor(BSIC_BRAND.colors.bleuNuit)
    .font(BSIC_BRAND.fonts.titre)
    .fontSize(BSIC_BRAND.fontSizes.section)
    .text('ANALYSE MIZNAS AI', left, y, {
      width: widthDispo,
      lineBreak: false,
    });
  y += 24;

  // Sous-titre métadonnées
  const generatedAtStr = ia.generatedAt ? formaterDateFr(ia.generatedAt) : '—';
  doc
    .fillColor(BSIC_BRAND.colors.grisFonce)
    .font(BSIC_BRAND.fonts.italic)
    .fontSize(BSIC_BRAND.fontSizes.bodySmall)
    .text(
      `Modèle : ${ia.model}  ·  Générée le ${generatedAtStr}  ·  ` +
        `Tokens : ${String(ia.tokensInput)} in / ${String(ia.tokensOutput)} out  ·  ` +
        `Durée : ${String(ia.dureeMs)} ms`,
      left,
      y,
      { width: widthDispo, lineBreak: false },
    );
  y += 18;

  // Badge dry-run si pertinent
  if (ia.dryRun) {
    doc.save().fillColor('#BA751714').rect(left, y, 110, 18).fill().restore();
    doc
      .fillColor('#BA7517')
      .font(BSIC_BRAND.fonts.titre)
      .fontSize(BSIC_BRAND.fontSizes.bodySmall)
      .text('Mode test (DRY_RUN)', left + 6, y + 4, {
        width: 100,
        lineBreak: false,
      });
    y += 26;
  } else {
    y += 6;
  }

  // Contenu markdown
  doc.x = left;
  doc.y = y;
  renderMarkdown(doc, ia.analyse);

  // Disclaimer en bas de page (positionné à 80pt du bas)
  const disclaimerY = doc.page.height - doc.page.margins.bottom - 40;
  doc
    .fillColor(BSIC_BRAND.colors.grisFonce)
    .font(BSIC_BRAND.fonts.italic)
    .fontSize(BSIC_BRAND.fontSizes.bodySmall - 1)
    .text(
      'Cette analyse est générée automatiquement et doit être validée par un humain. ' +
        "MIZNAS AI ne remplace pas l'expertise d'un contrôleur de gestion.",
      left,
      disclaimerY,
      { width: widthDispo, align: 'center' },
    );
}
