/**
 * PdfBuilderService (Lot 7.6) — helper autour de pdfkit pour la
 * génération de rapports MIZNAS.
 *
 * Réutilisable par les ~20 rapports à venir (R01–R20). Encapsule la
 * charte graphique BSIC NIGER (couleurs, polices, marges) et les
 * primitives récurrentes : header, footer paginé, encadré officiel,
 * tableau, cachet BCEAO.
 *
 * Le service N'IMPOSE PAS de cycle de vie : chaque rapport crée son
 * propre PDFDocument via `createDocument()` puis appelle les
 * helpers selon sa structure.
 */
import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';

/**
 * Formate un nombre en string avec espace ASCII (U+0020) comme
 * séparateur de milliers.
 *
 * **POURQUOI un helper dédié** (Lot 7.6.bis fix #1) :
 * `Intl.NumberFormat('fr-FR').format(n)` produit U+202F (NARROW NO-BREAK
 * SPACE) qui n'est PAS dans la table de glyphes Helvetica/Times standard
 * de pdfkit (encodage WinAnsi/Latin-1). Résultat : tous les montants
 * formatés s'affichaient avec `/` à la place de l'espace milliers dans
 * les PDFs du Lot 7.6 initial. L'espace ASCII normal est rendu
 * correctement par toutes les polices PDF de base.
 *
 * Retourne `'—'` pour les valeurs invalides (null/undefined/NaN).
 */
export function formatMontant(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/**
 * Variante signée de `formatMontant` : négatifs préfixés `-`.
 * Ex: `-3681000000` → `-3 681 000 000`.
 */
export function formatMontantSigne(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  const abs = formatMontant(Math.abs(n));
  return n < 0 ? `-${abs}` : abs;
}

/**
 * Charte BSIC NIGER — palette et conventions utilisées pour TOUS les
 * rapports MIZNAS. Source : Charte v1 + maquette R04 validée Lot 7.6
 * + hiérarchie typographique + espacement vertical Lot 7.6.bis.
 */
export const BSIC_BRAND = {
  colors: {
    bleuNuit: '#1B2A4E',
    bleuNuitDark: '#0F1B33',
    or: '#C49B3F',
    rouge: '#C0392B',
    vert: '#0F6E56',
    orange: '#E67E22',
    grisClair: '#F4F6F8',
    grisFonce: '#5A6171',
    blanc: '#FFFFFF',
    // Lot 7.6.bis — palette étendue.
    creme: '#FDF6E3', // fond cachet BCEAO
    blancCasse: '#FAFAFA', // bandes alternées tableaux
  },
  fonts: {
    titre: 'Helvetica-Bold',
    body: 'Helvetica',
    italic: 'Helvetica-Oblique',
  },
  /**
   * Hiérarchie typographique (Lot 7.6.bis fix amélioration #3).
   * Toute taille de police dans le template R04 DOIT venir d'ici.
   */
  fontSizes: {
    titreGarde: 26, // gros titre page de garde
    sousTitreGarde: 11, // sous-titre BSIC NIGER S.A.
    section: 14, // "I. TRAÇABILITÉ..." etc.
    sousSection: 12, // "A. PRODUITS", "B. CHARGES"
    body: 10, // texte courant
    bodySmall: 9, // texte secondaire
    tableHeader: 9, // entête de tableau
    tableCell: 9, // cellule de tableau
    tableSmall: 8, // tableaux denses (CR, comptes)
    footer: 7, // footer paginé
    header: 8, // header récurrent
    metaSmall: 8, // métadonnées (email sous nom signature)
    italicNote: 9, // notes en bas de section
  },
  marges: {
    haut: 50,
    bas: 60,
    gauche: 50,
    droite: 50,
  },
  /**
   * Espacement vertical standard (Lot 7.6.bis bonus). Utilisé via
   * `doc.moveDown(BSIC_BRAND.espacement.apresSection / 12)` (12 = base
   * d'une ligne pdfkit ≈ fontSize 10).
   */
  espacement: {
    apresSection: 18,
    apresSousSection: 10,
    apresParagraphe: 8,
    apresTableau: 14,
  },
} as const;

export interface PdfTableColumn {
  /** Label affiché dans l'en-tête de colonne. */
  header: string;
  /** Largeur en points (1 point = 1/72 pouce). */
  width: number;
  /** Alignement du contenu. Défaut: 'left'. */
  align?: 'left' | 'center' | 'right';
}

export interface PdfTableOptions {
  /** Couleur de fond de la ligne d'en-tête. Défaut: bleuNuit. */
  headerBg?: string;
  /** Couleur du texte de l'en-tête. Défaut: blanc. */
  headerColor?: string;
  /** Hauteur d'une ligne. Défaut: 22. */
  rowHeight?: number;
  /** Taille de police du contenu. Défaut: 9. */
  fontSize?: number;
}

@Injectable()
export class PdfBuilderService {
  /**
   * Crée un PDFDocument MIZNAS pré-configuré (A4, marges charte BSIC,
   * info metadata standard). Le caller manipule directement le doc
   * pour streamer le contenu — typiquement via `doc.pipe(res)`.
   */
  createDocument(meta: {
    title: string;
    author?: string;
    subject?: string;
  }): PDFKit.PDFDocument {
    return new PDFDocument({
      size: 'A4',
      margins: {
        top: BSIC_BRAND.marges.haut,
        bottom: BSIC_BRAND.marges.bas,
        left: BSIC_BRAND.marges.gauche,
        right: BSIC_BRAND.marges.droite,
      },
      info: {
        Title: meta.title,
        Author: meta.author ?? 'MIZNAS — BSIC NIGER',
        Subject: meta.subject ?? meta.title,
        Producer: 'MIZNAS / pdfkit',
        Creator: 'MIZNAS',
      },
      bufferPages: true,
    });
  }

  /**
   * Placeholder pour le logo BSIC NIGER (Lot 7.6.bis fix #7 — refonte).
   *
   * Rectangle plein bleu nuit + bordure or fine + "BSIC" bold blanc +
   * "NIGER" or. Sobre, lisible, conforme à la charte. Sera remplacé par
   * un PNG/SVG quand un asset officiel sera fourni par BSIC.
   */
  drawLogoPlaceholder(
    doc: PDFKit.PDFDocument,
    x: number,
    y: number,
    width = 150,
    height = 70,
  ): void {
    doc
      .save()
      // Fond bleu nuit
      .rect(x, y, width, height)
      .fillColor(BSIC_BRAND.colors.bleuNuit)
      .fill();
    // Bordure or fine
    doc
      .rect(x, y, width, height)
      .lineWidth(1.5)
      .strokeColor(BSIC_BRAND.colors.or)
      .stroke();
    // "BSIC" bold blanc
    doc
      .font(BSIC_BRAND.fonts.titre)
      .fontSize(20)
      .fillColor('#FFFFFF')
      .text('BSIC', x, y + 14, { width, align: 'center', lineBreak: false });
    // "NIGER" or
    doc
      .font(BSIC_BRAND.fonts.body)
      .fontSize(11)
      .fillColor(BSIC_BRAND.colors.or)
      .text('NIGER', x, y + 42, { width, align: 'center', lineBreak: false });
    doc.restore();
  }

  /**
   * Encadré officiel : rectangle bleu nuit avec label en haut et valeur
   * en dessous. Utilisé pour les blocs métadonnées de la page de garde.
   */
  drawInfoBox(
    doc: PDFKit.PDFDocument,
    x: number,
    y: number,
    width: number,
    rows: Array<{ label: string; value: string }>,
  ): void {
    const padding = 10;
    const lineHeight = 18;
    const height = padding * 2 + rows.length * lineHeight;

    doc
      .save()
      .lineWidth(1.2)
      .strokeColor(BSIC_BRAND.colors.bleuNuit)
      .fillColor(BSIC_BRAND.colors.grisClair)
      .rect(x, y, width, height)
      .fillAndStroke();

    let cursorY = y + padding;
    for (const r of rows) {
      doc
        .fillColor(BSIC_BRAND.colors.grisFonce)
        .font(BSIC_BRAND.fonts.body)
        .fontSize(9)
        .text(r.label, x + padding, cursorY, { width: width * 0.45 });
      doc
        .fillColor(BSIC_BRAND.colors.bleuNuitDark)
        .font(BSIC_BRAND.fonts.titre)
        .fontSize(10)
        .text(r.value, x + width * 0.45, cursorY, {
          width: width * 0.55 - padding,
          align: 'right',
        });
      cursorY += lineHeight;
    }
    doc.restore();
  }

  /**
   * Cachet officiel "BUDGET GELÉ BCEAO" (Lot 7.6.bis fix #5 — refonte
   * visuelle). Double bordure rouge sur fond crème, titre principal +
   * sous-titre conservation + référence audit_log.
   *
   * `x`/`y` ancrent le coin top-left du cachet. Pour un cachet centré,
   * passer `x = (page.width - width) / 2`. `width` par défaut 220pt.
   */
  drawBceaoStamp(
    doc: PDFKit.PDFDocument,
    x: number,
    y: number,
    width: number,
    referenceAudit: string,
  ): void {
    const height = 100;
    doc.save();
    // Fond crème pâle
    doc.rect(x, y, width, height).fillColor('#FDF6E3').fill();
    // Bordure extérieure rouge épaisse
    doc
      .rect(x, y, width, height)
      .lineWidth(2)
      .strokeColor(BSIC_BRAND.colors.rouge)
      .stroke();
    // Bordure intérieure rouge fine (effet cachet officiel)
    doc
      .rect(x + 4, y + 4, width - 8, height - 8)
      .lineWidth(0.5)
      .strokeColor(BSIC_BRAND.colors.rouge)
      .stroke();
    // Titre principal
    doc
      .fillColor(BSIC_BRAND.colors.rouge)
      .font(BSIC_BRAND.fonts.titre)
      .fontSize(13)
      .text('BUDGET GELÉ BCEAO', x, y + 18, {
        width,
        align: 'center',
        lineBreak: false,
      });
    // Sous-titre conservation
    doc
      .font(BSIC_BRAND.fonts.body)
      .fontSize(9)
      .fillColor(BSIC_BRAND.colors.rouge)
      .text('Conservation 10 ans', x, y + 40, {
        width,
        align: 'center',
        lineBreak: false,
      });
    // Référence audit_log
    doc
      .font(BSIC_BRAND.fonts.body)
      .fontSize(8)
      .fillColor(BSIC_BRAND.colors.grisFonce)
      .text(`Réf. audit ${referenceAudit}`, x, y + 62, {
        width,
        align: 'center',
        lineBreak: false,
      });
    // Mention cachet électronique
    doc
      .font(BSIC_BRAND.fonts.italic)
      .fontSize(7)
      .fillColor(BSIC_BRAND.colors.grisFonce)
      .text('Cachet électronique MIZNAS', x, y + 78, {
        width,
        align: 'center',
        lineBreak: false,
      });
    doc.restore();
  }

  /**
   * Dessine un tableau (header + lignes). Le caller passe les colonnes
   * (header + width + align) et les lignes (string[]). Si le tableau
   * dépasse la page, le caller doit gérer le saut (drawTable retourne
   * le `y` final pour qu'on sache où on est).
   *
   * @returns la coordonnée `y` après la dernière ligne dessinée.
   */
  drawTable(
    doc: PDFKit.PDFDocument,
    columns: PdfTableColumn[],
    rows: string[][],
    options: PdfTableOptions = {},
  ): number {
    const headerBg = options.headerBg ?? BSIC_BRAND.colors.bleuNuit;
    const headerColor = options.headerColor ?? BSIC_BRAND.colors.blanc;
    const rowHeight = options.rowHeight ?? 22;
    const fontSize = options.fontSize ?? 9;

    const x0 = doc.x;
    let y = doc.y;

    // Header
    let cx = x0;
    doc
      .save()
      .fillColor(headerBg)
      .rect(
        x0,
        y,
        columns.reduce((s, c) => s + c.width, 0),
        rowHeight,
      )
      .fill();
    doc.fillColor(headerColor).font(BSIC_BRAND.fonts.titre).fontSize(fontSize);
    for (const col of columns) {
      doc.text(col.header, cx + 4, y + 6, {
        width: col.width - 8,
        align: col.align ?? 'left',
      });
      cx += col.width;
    }
    doc.restore();
    y += rowHeight;

    // Lignes
    doc.font(BSIC_BRAND.fonts.body).fontSize(fontSize);
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (i % 2 === 1) {
        doc
          .save()
          .fillColor(BSIC_BRAND.colors.grisClair)
          .rect(
            x0,
            y,
            columns.reduce((s, c) => s + c.width, 0),
            rowHeight,
          )
          .fill()
          .restore();
      }
      doc.fillColor(BSIC_BRAND.colors.bleuNuitDark);
      cx = x0;
      for (let j = 0; j < columns.length; j++) {
        const col = columns[j];
        doc.text(row[j] ?? '', cx + 4, y + 6, {
          width: col.width - 8,
          align: col.align ?? 'left',
        });
        cx += col.width;
      }
      y += rowHeight;
    }

    doc.y = y;
    return y;
  }

  /**
   * Ajoute le footer paginé sur toutes les pages EXISTANTES du document.
   *
   * **CRITIQUE — appel obligatoire EN TOUT DERNIER, juste avant
   * `doc.end()`** : sinon `bufferedPageRange()` retourne 0 pages.
   *
   * **Bug Lot 7.6 initial (#2 — footer dupliqué × 30)** :
   *   - position Y initiale : `page.height - 60 + 15 = 797` (sur A4=842)
   *   - marges bas par défaut = 60 → zone utile s'arrête à `y=782`
   *   - donc le footer débordait dans la marge basse, et `doc.text()`
   *     sans `lineBreak: false` créait des pages auto pour le wrap
   *   - `bufferedPageRange().count` augmentait pendant l'itération
   *     → cascade : chaque footer en générait 2-3 nouveaux jusqu'à 37 pages
   *
   * **Fix** :
   *   - position Y plus haute : `page.height - 35` (au-dessus de la marge bas)
   *   - `lineBreak: false` sur chaque `text()` pour interdire le wrap auto
   *   - `total` capturé UNE FOIS hors de la boucle (snapshot)
   *   - itération stricte de 0 à total exclu, jamais d'addPage()
   */
  applyFooterToAllPages(
    doc: PDFKit.PDFDocument,
    parts: { left: string; center: string },
    options: { skipFirstPage?: boolean } = {},
  ): void {
    const range = doc.bufferedPageRange();
    const total = range.count;

    for (let i = 0; i < total; i++) {
      if (options.skipFirstPage && i === 0) continue;
      doc.switchToPage(range.start + i);
      this.drawFooterOnCurrentPage(doc, {
        left: parts.left,
        center: parts.center,
        pageNumber: i + 1,
        totalPages: total,
      });
    }
  }

  /**
   * Dessine le footer sur la page courante (assume `switchToPage` déjà
   * fait par l'appelant). Position Y au-dessus de la marge basse pour
   * éviter le débordement qui déclenchait l'auto-pagination de pdfkit.
   */
  private drawFooterOnCurrentPage(
    doc: PDFKit.PDFDocument,
    parts: {
      left: string;
      center: string;
      pageNumber: number;
      totalPages: number;
    },
  ): void {
    const pageWidth = doc.page.width;
    const left = BSIC_BRAND.marges.gauche;
    const right = pageWidth - BSIC_BRAND.marges.droite;
    const width = right - left;
    const footerY = doc.page.height - 35;

    doc
      .save()
      .lineWidth(0.5)
      .strokeColor(BSIC_BRAND.colors.or)
      .moveTo(left, footerY - 8)
      .lineTo(right, footerY - 8)
      .stroke();
    doc
      .fillColor(BSIC_BRAND.colors.grisFonce)
      .font(BSIC_BRAND.fonts.body)
      .fontSize(7);
    // lineBreak: false — empêche `text()` de créer une page auto si
    // le contenu dépasse la zone utile (bug Lot 7.6 initial).
    doc.text(parts.left, left, footerY, {
      width: width / 3,
      align: 'left',
      lineBreak: false,
    });
    doc.text(parts.center, left + width / 3, footerY, {
      width: width / 3,
      align: 'center',
      lineBreak: false,
    });
    doc.text(
      `Page ${parts.pageNumber}/${parts.totalPages}`,
      left + (2 * width) / 3,
      footerY,
      { width: width / 3, align: 'right', lineBreak: false },
    );
    doc.restore();
  }

  /**
   * Applique le header récurrent sur toutes les pages SAUF la première
   * (page de garde) (Lot 7.6.bis amélioration #2). Symétrique au footer
   * mais positionné dans la marge haute. Filet or fin en dessous.
   *
   * Mêmes précautions que le footer : appel obligatoire EN TOUT DERNIER,
   * `bufferPages: true` requis, `lineBreak: false` sur chaque `text()`.
   */
  applyHeaderToAllPagesExceptFirst(
    doc: PDFKit.PDFDocument,
    parts: { left: string; center: string; right: string },
  ): void {
    const range = doc.bufferedPageRange();
    const total = range.count;
    // Toujours skip la page 0 (garde).
    for (let i = 1; i < total; i++) {
      doc.switchToPage(range.start + i);
      this.drawHeaderOnCurrentPage(doc, parts);
    }
  }

  /**
   * Dessine le header sur la page courante (assume `switchToPage` déjà
   * fait par l'appelant). Position Y dans la marge haute, au-dessus du
   * contenu.
   */
  private drawHeaderOnCurrentPage(
    doc: PDFKit.PDFDocument,
    parts: { left: string; center: string; right: string },
  ): void {
    const pageWidth = doc.page.width;
    const left = BSIC_BRAND.marges.gauche;
    const right = pageWidth - BSIC_BRAND.marges.droite;
    const width = right - left;
    const headerY = 22;

    doc
      .save()
      .fillColor(BSIC_BRAND.colors.grisFonce)
      .font(BSIC_BRAND.fonts.body)
      .fontSize(BSIC_BRAND.fontSizes.header);
    doc.text(parts.left, left, headerY, {
      width: width / 3,
      align: 'left',
      lineBreak: false,
    });
    doc.text(parts.center, left + width / 3, headerY, {
      width: width / 3,
      align: 'center',
      lineBreak: false,
    });
    doc.text(parts.right, left + (2 * width) / 3, headerY, {
      width: width / 3,
      align: 'right',
      lineBreak: false,
    });
    // Filet or fin en dessous du header (séparateur visuel).
    doc
      .lineWidth(0.5)
      .strokeColor(BSIC_BRAND.colors.or)
      .moveTo(left, headerY + 12)
      .lineTo(right, headerY + 12)
      .stroke();
    doc.restore();
  }

  /**
   * Pagination défensive (Lot 7.6.bis amélioration #4) : ajoute une
   * nouvelle page UNIQUEMENT si la hauteur restante sur la page
   * courante est inférieure à `requiredHeight`. Évite les titres
   * orphelins en bas de page et les tableaux coupés.
   *
   * Précision approximative — on estime la hauteur d'un bloc à venir,
   * pas besoin d'être pixel-perfect. En cas de débordement réel,
   * pdfkit gère le saut auto.
   */
  ensureSpaceOrNewPage(doc: PDFKit.PDFDocument, requiredHeight: number): void {
    const currentY = doc.y;
    const pageBottom = doc.page.height - BSIC_BRAND.marges.bas;
    const available = pageBottom - currentY;
    if (available < requiredHeight) {
      doc.addPage();
    }
  }

  /**
   * Sectionne le document : titre de section (h2) en bleu nuit + barre
   * or fine en dessous. Retourne le `y` final pour chaîner le contenu.
   */
  drawSectionTitle(doc: PDFKit.PDFDocument, title: string): number {
    doc
      .fillColor(BSIC_BRAND.colors.bleuNuit)
      .font(BSIC_BRAND.fonts.titre)
      .fontSize(BSIC_BRAND.fontSizes.section)
      .text(title);
    const y = doc.y + 2;
    doc
      .save()
      .lineWidth(1.5)
      .strokeColor(BSIC_BRAND.colors.or)
      .moveTo(BSIC_BRAND.marges.gauche, y)
      .lineTo(BSIC_BRAND.marges.gauche + 60, y)
      .stroke()
      .restore();
    doc.moveDown(0.6);
    return doc.y;
  }
}
