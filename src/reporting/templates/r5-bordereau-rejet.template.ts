/**
 * Template R5 — Bordereau de rejet (Lot 8.4).
 *
 * Atteste qu'un document métier MIZNAS a été rejeté par un viseur du
 * Comité de validation. Généré à la volée par
 * `BordereauService.genererBordereauRejet()` dès qu'au moins un
 * `document_visa` au statut `REJETE` existe pour le document.
 *
 * Format consolidé sur le 1er rejet trouvé. Si plusieurs rejets dans
 * l'historique (cas rare), seul le 1er rejet trouvé par ordre_visa
 * ASC est documenté.
 *
 * Charte alignée R04 BCEAO mais accent visuel distinctif **rouge**
 * pour signaler immédiatement qu'il s'agit d'un rejet :
 *  - Titre encadré rouge
 *  - Bloc rejet avec fond rouge clair + bordure rouge
 *  - Mention "REJET" en filigrane
 */
import type {
  BordereauR5Data,
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

export function buildR5Pdf(
  doc: PDFKit.PDFDocument,
  data: BordereauR5Data,
  pdf: PdfBuilderService,
  bank: BankBranding = DEFAULT_BANK_BRANDING,
): void {
  const { document, visaRejete } = data;
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

  // ─── 2. Titre encadré "BORDEREAU DE REJET" (ROUGE distinctif) ───
  const titleY = doc.y;
  const titleHeight = 40;
  doc
    .save()
    .rect(contentX, titleY, contentWidth, titleHeight)
    .lineWidth(2)
    .strokeColor(BRAND.colors.rouge)
    .fillColor('#FCEEEE')
    .fillAndStroke();
  doc
    .font(BRAND.fonts.titre)
    .fontSize(18)
    .fillColor(BRAND.colors.rouge)
    .text('BORDEREAU DE REJET', contentX, titleY + 11, {
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
    { label: 'Statut actuel', value: document.statut },
  ]);
  doc.y += 10;
  doc.moveDown(1);

  // ─── 4. Bloc rejet — fond rouge clair distinctif ────────────────
  doc
    .font(BRAND.fonts.titre)
    .fontSize(BRAND.fontSizes.section)
    .fillColor(BRAND.colors.rouge)
    .text('Détail du rejet', contentX, doc.y);
  doc.moveDown(0.5);

  const blocY = doc.y;
  const blocHeight = 110;
  doc
    .save()
    .rect(contentX, blocY, contentWidth, blocHeight)
    .lineWidth(1.2)
    .strokeColor(BRAND.colors.rouge)
    .fillColor('#FCEEEE')
    .fillAndStroke();
  doc.restore();

  const labelX = contentX + 12;
  const valueX = contentX + 150;
  const valueWidth = contentWidth - 162;
  let blocCursor = blocY + 12;
  const lineHeight = 22;

  const rows: Array<{ label: string; value: string }> = [
    { label: 'Auteur du rejet :', value: formatNomComplet(visaRejete) },
    { label: 'Fonction :', value: visaRejete.libelleFonction ?? '—' },
    { label: 'Date du rejet :', value: formatDateFr(visaRejete.dateAction) },
    {
      label: 'Motif :',
      value: visaRejete.commentaire ?? '(motif non précisé)',
    },
  ];
  for (const r of rows) {
    doc
      .font(BRAND.fonts.titre)
      .fontSize(BRAND.fontSizes.body)
      .fillColor(BRAND.colors.rouge)
      .text(r.label, labelX, blocCursor, { width: 130, lineBreak: false });
    doc
      .font(BRAND.fonts.body)
      .fontSize(BRAND.fontSizes.body)
      .fillColor(BRAND.colors.bleuNuitDark)
      .text(r.value, valueX, blocCursor, { width: valueWidth });
    blocCursor += lineHeight;
  }
  doc.y = blocY + blocHeight + 18;

  // ─── 5. Bloc instructions ───────────────────────────────────────
  doc
    .font(BRAND.fonts.italic)
    .fontSize(BRAND.fontSizes.body)
    .fillColor(BRAND.colors.grisFonce)
    .text(
      "Le document susvisé fait l'objet d'un rejet et devra être révisé " +
        'par son émetteur avant une nouvelle soumission au workflow de ' +
        "validation. Le présent bordereau fait foi pour l'audit BCEAO " +
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

  // Mention de génération
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

  // ─── 7. Footer ──────────────────────────────────────────────────
  pdf.applyFooterToAllPages(doc, {
    left: `${bank.nom} S.A. — R5 Bordereau Rejet — ${document.codeDocument}`,
    center: 'CONFIDENTIEL',
  });
}
