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

import { BSIC_BRAND } from '../../reporting/generators/pdf-builder.service';

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
export function nettoyerEmojis(markdown: string): string {
  let out = markdown;
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
 * Rend une chaîne avec balises gras `**…**` en alternant le run
 * Helvetica / Helvetica-Bold dans le PDF. Le texte est écrit à
 * la position courante (`continued: true` pour les segments non
 * finaux, dernier segment ferme la ligne).
 */
function rendreLigneInline(
  doc: PDFKit.PDFDocument,
  ligne: string,
  fontSize: number,
): void {
  // Découpe sur les balises **gras** en conservant les délimiteurs.
  const parts = ligne.split(/(\*\*[^*]+\*\*)/g);
  doc.fillColor(BSIC_BRAND.colors.bleuNuitDark).fontSize(fontSize);
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    const isLast = i === parts.length - 1;
    if (p.startsWith('**') && p.endsWith('**')) {
      doc
        .font(BSIC_BRAND.fonts.titre)
        .text(p.slice(2, -2), { continued: !isLast });
    } else if (p.length > 0) {
      doc.font(BSIC_BRAND.fonts.body).text(p, { continued: !isLast });
    } else if (isLast) {
      // Force la fermeture de la ligne si le dernier segment est vide.
      doc.text('', { continued: false });
    }
  }
}

/**
 * Rend un markdown structuré dans un PDFDocument à la position
 * courante. Le caller doit avoir positionné `doc.y` au bon endroit.
 *
 * Conventions :
 *  - Titres `##` et `###` : couleur bleu nuit + espacement
 *  - Bullets `- ` ou `* ` : préfixe `•` + retrait
 *  - Listes numérotées `1. ` : préfixe `N.` + retrait
 *  - Lignes vides : `moveDown(0.5)`
 *  - Paragraphes : texte standard largeur disponible
 */
export function renderMarkdown(
  doc: PDFKit.PDFDocument,
  markdown: string,
): void {
  const cleaned = nettoyerEmojis(markdown).replace(/\r\n?/g, '\n');
  const lignes = cleaned.split('\n');

  const widthDispo =
    doc.page.width - doc.page.margins.left - doc.page.margins.right;

  for (const raw of lignes) {
    const ligne = raw.trimEnd();
    if (ligne.length === 0) {
      doc.moveDown(0.4);
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

    // Bullet list (- … ou * …)
    const bullet = /^[-*]\s+(.+)$/.exec(ligne);
    if (bullet) {
      const startX = doc.x;
      doc.text('•  ', { continued: true });
      rendreLigneInline(doc, bullet[1], BSIC_BRAND.fontSizes.body);
      doc.x = startX;
      continue;
    }

    // Liste numérotée (1. …, 2. …)
    const numLi = /^(\d+)\.\s+(.+)$/.exec(ligne);
    if (numLi) {
      const startX = doc.x;
      doc.text(`${numLi[1]}.  `, { continued: true });
      rendreLigneInline(doc, numLi[2], BSIC_BRAND.fontSizes.body);
      doc.x = startX;
      continue;
    }

    // Paragraphe normal — peut contenir du gras inline.
    rendreLigneInline(doc, ligne, BSIC_BRAND.fontSizes.body);
  }
}
