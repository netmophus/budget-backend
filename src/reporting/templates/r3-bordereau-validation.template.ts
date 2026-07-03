/**
 * Template R3 — Bordereau de validation (Lot 8.4).
 *
 * Atteste qu'un document métier MIZNAS a recueilli tous les visas
 * obligatoires de son Comité de validation. Généré à la volée par
 * `BordereauService.genererBordereauValidation()` quand le document
 * atteint le statut `VISE` ou `SIGNE`.
 *
 * Format consolidé (décision A.2 actée) : 1 R3 unique listant TOUS
 * les viseurs ayant validé positivement, pas 1 R3 par visa.
 *
 * Charte alignée R04 BCEAO (Lot 7.6.bis) :
 *  - En-tête BSIC NIGER + adresse
 *  - Titre encadré "BORDEREAU DE VALIDATION" (vert sobre)
 *  - drawInfoBox identification document
 *  - drawTable viseurs (4 colonnes : N° / Fonction / Nom / Date)
 *  - Bloc certification
 *  - drawBceaoStamp + date du jour
 *  - Footer "Généré le … par MIZNAS"
 */
import type {
  BordereauR3Data,
  BordereauVisaEntry,
} from '../services/bordereau.service';
import {
  BRAND,
  type PdfBuilderService,
} from '../generators/pdf-builder.service';
import {
  DEFAULT_BANK_BRANDING,
  type BankBranding,
} from '../../configuration-banque/bank-branding';

function formatDateFr(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function formatNomComplet(v: BordereauVisaEntry): string {
  if (!v.viseurNom && !v.viseurPrenom) return v.viseurEmail ?? '—';
  return `${v.viseurPrenom ?? ''} ${v.viseurNom ?? ''}`.trim();
}

export function buildR3Pdf(
  doc: PDFKit.PDFDocument,
  data: BordereauR3Data,
  pdf: PdfBuilderService,
  bank: BankBranding = DEFAULT_BANK_BRANDING,
): void {
  const { document, visasValidants } = data;
  const pageWidth = doc.page.width;
  const contentX = BRAND.marges.gauche;
  const contentWidth = pageWidth - BRAND.marges.gauche - BRAND.marges.droite;

  // ─── 1. Logo + en-tête institutionnel ────────────────────────────
  pdf.drawLogoPlaceholder(doc, contentX, BRAND.marges.haut, 100, 50, bank);

  doc
    .font(BRAND.fonts.body)
    .fontSize(BRAND.fontSizes.bodySmall)
    .fillColor(BRAND.colors.grisFonce)
    .text(
      `${bank.nom} S.A.\n${bank.adresse}, ${bank.villeSiege}\nDirection Générale`,
      contentX + 110,
      BRAND.marges.haut + 5,
      { width: contentWidth - 110 },
    );

  doc.y = BRAND.marges.haut + 60;
  doc.moveDown(1.5);

  // ─── 2. Titre encadré "BORDEREAU DE VALIDATION" ─────────────────
  const titleY = doc.y;
  const titleHeight = 40;
  doc
    .save()
    .rect(contentX, titleY, contentWidth, titleHeight)
    .lineWidth(2)
    .strokeColor(BRAND.colors.vert)
    .fillColor(BRAND.colors.grisClair)
    .fillAndStroke();
  doc
    .font(BRAND.fonts.titre)
    .fontSize(18)
    .fillColor(BRAND.colors.bleuNuit)
    .text('BORDEREAU DE VALIDATION', contentX, titleY + 11, {
      width: contentWidth,
      align: 'center',
      lineBreak: false,
    });
  doc.restore();
  doc.y = titleY + titleHeight + 20;

  // ─── 3. Identification document (drawInfoBox) ───────────────────
  pdf.drawInfoBox(doc, contentX, doc.y, contentWidth, [
    { label: 'Type de document', value: document.typeDocument },
    { label: 'Référence', value: document.codeDocument },
    { label: 'Titre', value: document.titre },
    {
      label: 'Exercice budgétaire',
      value: document.exerciceFiscal ? String(document.exerciceFiscal) : '—',
    },
    {
      label: 'Émetteur',
      value:
        document.emetteurNom || document.emetteurPrenom
          ? `${document.emetteurPrenom ?? ''} ${document.emetteurNom ?? ''}`.trim()
          : (document.emetteurEmail ?? '—'),
    },
    { label: 'Date émission', value: formatDateFr(document.dateCreation) },
  ]);
  doc.y += 10;
  doc.moveDown(1);

  // ─── 4. Tableau consolidé des viseurs ───────────────────────────
  doc
    .font(BRAND.fonts.titre)
    .fontSize(BRAND.fontSizes.section)
    .fillColor(BRAND.colors.bleuNuit)
    .text('Visas recueillis', contentX, doc.y);
  doc.moveDown(0.5);

  doc.x = contentX;
  pdf.drawTable(
    doc,
    [
      { header: 'N°', width: 40, align: 'center' },
      { header: 'Fonction', width: 150 },
      { header: 'Nom du viseur', width: 165 },
      { header: 'Date du visa', width: 90, align: 'center' },
      { header: 'Commentaire', width: 50 },
    ],
    visasValidants.map((v) => [
      String(v.ordreVisa),
      v.libelleFonction ?? '—',
      formatNomComplet(v),
      formatDateFr(v.dateAction),
      v.commentaire ? '✓' : '—',
    ]),
    { rowHeight: 22, fontSize: 9 },
  );
  doc.moveDown(1.5);

  // ─── 5. Bloc certification ──────────────────────────────────────
  doc
    .font(BRAND.fonts.italic)
    .fontSize(BRAND.fontSizes.body)
    .fillColor(BRAND.colors.grisFonce)
    .text(
      'Le présent bordereau atteste que le document susvisé a recueilli ' +
        'les visas requis ci-dessus, conformément à la procédure de ' +
        `validation interne ${bank.nom}. Il fait foi pour l'audit BCEAO ` +
        '(conservation 10 ans).',
      contentX,
      doc.y,
      { width: contentWidth, align: 'justify' },
    );
  doc.moveDown(1.5);

  // ─── 6. Date de génération + mention MIZNAS ─────────────────────
  // Hotfix Lot 8.4 : suppression du bloc "BUDGET GELÉ BCEAO / Conservation
  // 10 ans" (`drawBceaoStamp`) initialement hérité par mimétisme du
  // template R04. Sémantiquement faux sur un bordereau de workflow visa :
  // R3/R5 ne sont PAS des budgets gelés ; la mention "Conservation 10 ans
  // BCEAO" relève des documents finaux (R04, documents signés), pas des
  // bordereaux dérivés. Le cachet `drawBceaoStamp` reste légitime sur R04.
  doc
    .font(BRAND.fonts.body)
    .fontSize(BRAND.fontSizes.body)
    .fillColor(BRAND.colors.bleuNuitDark)
    .text(
      `${bank.villeSiege}, le ${formatDateFr(new Date().toISOString())}`,
      contentX,
      doc.y,
      { width: contentWidth, align: 'left' },
    );
  doc.moveDown(1);

  // Mention de génération (avant le footer technique)
  doc
    .font(BRAND.fonts.italic)
    .fontSize(BRAND.fontSizes.bodySmall)
    .fillColor(BRAND.colors.grisFonce)
    .text(
      `Bordereau généré automatiquement par MIZNAS le ${formatDateFr(new Date().toISOString())}.`,
      contentX,
      doc.y,
      { width: contentWidth, align: 'center' },
    );

  // ─── 7. Footer (pattern R04 : left + center + page X/Y auto) ────
  pdf.applyFooterToAllPages(doc, {
    left: `${bank.nom} S.A. — R3 Bordereau Validation — ${document.codeDocument}`,
    center: 'CONFIDENTIEL',
  });
}
