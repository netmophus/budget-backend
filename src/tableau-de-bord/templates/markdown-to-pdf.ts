/**
 * markdown-to-pdf (Lot 8.6.B) — parser regex minimaliste qui rend
 * du markdown structuré dans un PDF pdfkit.
 *
 * Le markdown attendu est celui produit par MIZNAS AI (Lot 8.6.A
 * — Anthropic Claude system prompt) : sections `## H2`, sous-
 * sections `### H3`, listes `- bullet` ou `1. numérotée`, gras
 * `**texte**`, et paragraphes simples.
 *
 * Pré-traitement des emojis : Helvetica standard de pdfkit n'a
 * pas la table de glyphes Unicode étendue (cf. fix Lot 7.6.bis
 * #1 sur U+202F qui rendait `/`). On remplace les emojis
 * couramment produits par Claude par leurs équivalents texte.
 */
import type PDFKit from 'pdfkit';

import {
  BSIC_BRAND,
  type PdfBuilderService,
} from '../../reporting/generators/pdf-builder.service';

/**
 * Substitutions emoji → texte ASCII pour pdfkit Helvetica. La liste
 * couvre les emojis fréquents du system prompt MIZNAS AI. Les
 * emojis décoratifs (✨ 💡 📌) sont strippés sans remplacement.
 */
const EMOJI_MAP: Array<[RegExp, string]> = [
  [/🔴/gu, '[CRITIQUE]'],
  [/🟠/gu, '[ATTENTION]'],
  [/🟡/gu, '[ATTENTION]'],
  [/✅/gu, '[OK]'],
  [/❌/gu, '[NON]'],
  [/⚠️/gu, '[!]'],
  [/⚠/gu, '[!]'],
  [/✨/gu, ''],
  [/💡/gu, ''],
  [/📌/gu, ''],
  [/📊/gu, ''],
  [/📈/gu, ''],
  [/📉/gu, ''],
];

/**
 * Substitutions de symboles Unicode étendus vers leur équivalent
 * ASCII. Helvetica standard (WinAnsi/Latin-1) ne possède pas ces
 * glyphes ; sans substitution ils rendent des caractères corrompus
 * (≥ → "e, → → "). Appliqué AVANT le strip résiduel.
 */
const SYMBOL_MAP: Array<[RegExp, string]> = [
  [/≥/gu, '>='],
  [/≤/gu, '<='],
  [/→/gu, '->'],
  [/←/gu, '<-'],
  [/↔/gu, '<->'],
  [/≈/gu, '~'],
  [/≠/gu, '!='],
  [/[█▓▒░]/gu, ''], // block elements (barres de progression)
  [/[─━│┃┌┐└┘├┤┬┴┼╔╗╚╝═║]/gu, ''], // box drawing
];

/**
 * Strip de sécurité : tout symbole pictographique / flèche / opérateur
 * mathématique / forme géométrique encore présent après les maps. Plage
 * contiguë U+2190→U+27BF (flèches, opérateurs, technique, encadrés, box
 * drawing, blocs, géométrie, symboles divers, dingbats) + symboles
 * étendus + sélecteur de variante + plan emoji. Ne touche PAS les
 * caractères typographiques CP1252 (– — ' ' " " • … € ™, tous < U+2190)
 * qui rendent correctement en WinAnsi.
 */
const RESIDUAL_UNICODE = /[\u2190-\u27BF\u2B00-\u2BFF\u{1F000}-\u{1FAFF}]/gu;
/** Selecteur de variante emoji (U+FE0F), strippe hors classe (regle lint). */
const VARIATION_SELECTOR = /\uFE0F/gu;

/**
 * Nettoie le markdown pour un rendu Latin-1 sûr : emojis -> texte,
 * symboles Unicode étendus -> ASCII, puis strip des résidus. Filet de
 * sécurité côté serveur même si le system prompt cadre déjà l'IA.
 */
/**
 * SOUS-LOT 3 ajust. 4 — retire une ligne « Label : ████ » entièrement
 * (barre de progression produite par l'IA malgré le prompt). Sans ce
 * filtre, le strip des blocs laissait un label orphelin « Label : ».
 */
const DANGLING_BAR_LINE = /^[^\n:]*:[ \t]*[▀-▟]+[ \t]*\n?/gmu;

export function nettoyerEmojis(markdown: string): string {
  let out = markdown.replace(DANGLING_BAR_LINE, '');
  for (const [re, replacement] of EMOJI_MAP) {
    out = out.replace(re, replacement);
  }
  for (const [re, replacement] of SYMBOL_MAP) {
    out = out.replace(re, replacement);
  }
  out = out.replace(RESIDUAL_UNICODE, '');
  out = out.replace(VARIATION_SELECTOR, '');
  return out;
}

/**
 * Rend une chaîne inline avec **gras** et `code` : alterne les runs
 * Helvetica / Helvetica-Bold / Courier à la position courante
 * (`continued: true` sauf pour le dernier segment).
 */
function rendreLigneInline(
  doc: PDFKit.PDFDocument,
  ligne: string,
  fontSize: number,
): void {
  // Tokenise en conservant les délimiteurs **gras** et `code inline`.
  const parts = ligne
    .split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
    .filter((p) => p.length > 0);
  doc.fontSize(fontSize);
  if (parts.length === 0) {
    doc.text('', { continued: false });
    return;
  }
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    const isLast = i === parts.length - 1;
    if (p.startsWith('**') && p.endsWith('**')) {
      doc
        .fillColor(BSIC_BRAND.colors.bleuNuitDark)
        .font(BSIC_BRAND.fonts.titre)
        .text(p.slice(2, -2), { continued: !isLast });
    } else if (p.startsWith('`') && p.endsWith('`')) {
      // Code inline : Courier + couleur terracotta (pas de fond inline
      // en pdfkit, la police monospace suffit à le distinguer).
      doc
        .fillColor('#B4351E')
        .font('Courier')
        .text(p.slice(1, -1), { continued: !isLast });
    } else {
      doc
        .fillColor(BSIC_BRAND.colors.bleuNuitDark)
        .font(BSIC_BRAND.fonts.body)
        .text(p, { continued: !isLast });
    }
  }
}

/** Découpe une ligne de tableau markdown en cellules (trim, pipes bord). */
function splitTableRow(ligne: string): string[] {
  return ligne
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());
}

/** Rend un bloc de code (``` ```) : fond gris + barre gauche + monospace. */
function renderCodeBlock(doc: PDFKit.PDFDocument, lignes: string[]): void {
  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  const fs = BSIC_BRAND.fontSizes.bodySmall;
  const lineH = fs + 3;
  const h = lignes.length * lineH + 8;
  const y = doc.y;
  doc.save().fillColor('#F1F3F5').rect(left, y, width, h).fill().restore();
  doc.save().fillColor('#94A3B8').rect(left, y, 3, h).fill().restore();
  let ly = y + 4;
  for (const l of lignes) {
    doc
      .fillColor('#334155')
      .font('Courier')
      .fontSize(fs)
      .text(l, left + 10, ly, { width: width - 16, lineBreak: false });
    ly += lineH;
  }
  doc.y = y + h + 4;
  doc.x = left;
}

/** Rend une citation (> …) : bloc gris en retrait + bordure or à gauche. */
function renderBlockquote(doc: PDFKit.PDFDocument, texte: string): void {
  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  const fs = BSIC_BRAND.fontSizes.body;
  doc.font(BSIC_BRAND.fonts.italic).fontSize(fs);
  const h = doc.heightOfString(texte, { width: width - 24 }) + 10;
  const y = doc.y;
  doc.save().fillColor('#F4F6F8').rect(left, y, width, h).fill().restore();
  doc
    .save()
    .fillColor(BSIC_BRAND.colors.or)
    .rect(left, y, 3, h)
    .fill()
    .restore();
  doc
    .fillColor(BSIC_BRAND.colors.grisFonce)
    .font(BSIC_BRAND.fonts.italic)
    .fontSize(fs)
    .text(texte, left + 12, y + 5, { width: width - 24 });
  doc.y = y + h + 4;
  doc.x = left;
}

/** Rend un tableau markdown via drawTable (colonnes de largeur égale). */
function renderMarkdownTable(
  doc: PDFKit.PDFDocument,
  header: string[],
  rows: string[][],
  pdfBuilder?: PdfBuilderService,
): void {
  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  const n = Math.max(1, header.length);
  const colW = Math.floor(width / n);
  const columns = header.map((h, i) => ({
    header: h,
    width: i === n - 1 ? width - colW * (n - 1) : colW,
  }));
  doc.x = left;
  if (pdfBuilder) {
    pdfBuilder.drawTable(doc, columns, rows, {
      fontSize: BSIC_BRAND.fontSizes.bodySmall,
    });
  } else {
    // Fallback sans pdfBuilder : rendu texte tabulé simple.
    doc.font(BSIC_BRAND.fonts.body).fontSize(BSIC_BRAND.fontSizes.bodySmall);
    doc.text(
      [header.join('  |  '), ...rows.map((r) => r.join('  |  '))].join('\n'),
      left,
      doc.y,
      { width },
    );
  }
  doc.moveDown(0.5);
}

/**
 * Rend un markdown structuré dans un PDFDocument à la position
 * courante. Le caller doit avoir positionné `doc.y` au bon endroit.
 *
 * Syntaxe gérée (SOUS-LOT 3.3) :
 *  - Titres `#` (bandeau), `##`, `###`
 *  - Tableaux `| a | b |` (+ ligne séparatrice) -> drawTable
 *  - Citations `> …` -> bloc gris bordé or
 *  - Code `` `inline` `` et blocs ``` ``` (monospace)
 *  - Bullets `-`/`*`, listes numérotées, gras `**…**`
 */
export function renderMarkdown(
  doc: PDFKit.PDFDocument,
  markdown: string,
  pdfBuilder?: PdfBuilderService,
): void {
  const cleaned = nettoyerEmojis(markdown).replace(/\r\n?/g, '\n');
  const lignes = cleaned.split('\n');

  const widthDispo =
    doc.page.width - doc.page.margins.left - doc.page.margins.right;

  for (let idx = 0; idx < lignes.length; idx++) {
    const ligne = lignes[idx].trimEnd();

    // Bloc de code ``` … ```
    if (/^\s*```/.test(ligne)) {
      const code: string[] = [];
      idx++;
      while (idx < lignes.length && !/^\s*```/.test(lignes[idx])) {
        code.push(lignes[idx]);
        idx++;
      }
      renderCodeBlock(doc, code);
      continue;
    }

    if (ligne.length === 0) {
      doc.moveDown(0.4);
      continue;
    }

    // Tableau : ligne "| … |" suivie d'une ligne séparatrice "|---|".
    if (
      /^\s*\|.*\|\s*$/.test(ligne) &&
      idx + 1 < lignes.length &&
      /^\s*\|?[\s:|-]+\|?\s*$/.test(lignes[idx + 1]) &&
      lignes[idx + 1].includes('-')
    ) {
      const header = splitTableRow(ligne);
      idx += 2; // saute l'en-tête + la séparatrice
      const rows: string[][] = [];
      while (idx < lignes.length && /^\s*\|.*\|\s*$/.test(lignes[idx])) {
        rows.push(splitTableRow(lignes[idx]));
        idx++;
      }
      idx--; // la boucle for ré-incrémentera
      renderMarkdownTable(doc, header, rows, pdfBuilder);
      continue;
    }

    // Titre H1 (# …) -> bandeau coloré (si pdfBuilder dispo).
    const h1 = /^#\s+(.+)$/.exec(ligne);
    if (h1) {
      doc.moveDown(0.3);
      if (pdfBuilder) {
        pdfBuilder.drawColoredBanner(doc, h1[1]);
      } else {
        doc
          .fillColor(BSIC_BRAND.colors.bleuNuit)
          .font(BSIC_BRAND.fonts.titre)
          .fontSize(BSIC_BRAND.fontSizes.section)
          .text(h1[1], { width: widthDispo });
        doc.moveDown(0.2);
      }
      continue;
    }

    // Titre H2 (## …)
    const h2 = /^##\s+(.+)$/.exec(ligne);
    if (h2) {
      doc.moveDown(0.4);
      doc
        .fillColor(BSIC_BRAND.colors.bleuNuit)
        .font(BSIC_BRAND.fonts.titre)
        .fontSize(BSIC_BRAND.fontSizes.sousSection + 1)
        .text(h2[1], { width: widthDispo });
      doc.moveDown(0.2);
      continue;
    }

    // Titre H3 (### …)
    const h3 = /^###\s+(.+)$/.exec(ligne);
    if (h3) {
      doc.moveDown(0.3);
      doc
        .fillColor(BSIC_BRAND.colors.bleuNuitDark)
        .font(BSIC_BRAND.fonts.titre)
        .fontSize(BSIC_BRAND.fontSizes.body + 1)
        .text(h3[1], { width: widthDispo });
      doc.moveDown(0.15);
      continue;
    }

    // Citation (> …)
    const bq = /^>\s?(.*)$/.exec(ligne);
    if (bq) {
      renderBlockquote(doc, bq[1]);
      continue;
    }

    // Bullet list (- … ou * …)
    const bullet = /^[-*]\s+(.+)$/.exec(ligne);
    if (bullet) {
      const startX = doc.x;
      doc.fillColor(BSIC_BRAND.colors.bleuNuitDark).text('•  ', {
        continued: true,
      });
      rendreLigneInline(doc, bullet[1], BSIC_BRAND.fontSizes.body);
      doc.x = startX;
      continue;
    }

    // Liste numérotée (1. …, 2. …)
    const numLi = /^(\d+)\.\s+(.+)$/.exec(ligne);
    if (numLi) {
      const startX = doc.x;
      doc.fillColor(BSIC_BRAND.colors.bleuNuitDark).text(`${numLi[1]}.  `, {
        continued: true,
      });
      rendreLigneInline(doc, numLi[2], BSIC_BRAND.fontSizes.body);
      doc.x = startX;
      continue;
    }

    // Paragraphe normal — gras + code inline.
    rendreLigneInline(doc, ligne, BSIC_BRAND.fontSizes.body);
  }
}
