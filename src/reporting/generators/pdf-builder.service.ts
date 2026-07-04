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

import {
  DEFAULT_BANK_BRANDING,
  type BankBranding,
} from '../../configuration-banque/bank-branding';

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
export const BRAND = {
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
   * `doc.moveDown(BRAND.espacement.apresSection / 12)` (12 = base
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

export interface PdfCellStyle {
  /** Fond de la cellule (badge). Si défini, texte en blanc par défaut. */
  bg?: string;
  /** Couleur du texte de la cellule. */
  color?: string;
  /** Texte en gras (Helvetica-Bold) — ex. lignes de total. */
  bold?: boolean;
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
  /**
   * SOUS-LOT 3.4 — style conditionnel par cellule (badge coloré). Reçoit
   * l'index de ligne/colonne + la valeur, retourne un fond/couleur ou
   * `undefined` pour le rendu par défaut.
   */
  cellStyle?: (
    rowIndex: number,
    colIndex: number,
    value: string,
  ) => PdfCellStyle | undefined;
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
        top: BRAND.marges.haut,
        bottom: BRAND.marges.bas,
        left: BRAND.marges.gauche,
        right: BRAND.marges.droite,
      },
      info: {
        Title: meta.title,
        Author: meta.author ?? 'MIZNAS',
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
    bank: BankBranding = DEFAULT_BANK_BRANDING,
  ): void {
    doc
      .save()
      // Fond couleur primaire
      .rect(x, y, width, height)
      .fillColor(bank.couleurPrimaire)
      .fill();
    // Bordure couleur secondaire fine
    doc
      .rect(x, y, width, height)
      .lineWidth(1.5)
      .strokeColor(bank.couleurSecondaire)
      .stroke();
    // Sigle bold blanc
    doc
      .font(BRAND.fonts.titre)
      .fontSize(20)
      .fillColor('#FFFFFF')
      .text(bank.sigle, x, y + 14, {
        width,
        align: 'center',
        lineBreak: false,
      });
    // Pays (couleur secondaire)
    doc
      .font(BRAND.fonts.body)
      .fontSize(11)
      .fillColor(bank.couleurSecondaire)
      .text(bank.pays.toUpperCase(), x, y + 42, {
        width,
        align: 'center',
        lineBreak: false,
      });
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
      .strokeColor(BRAND.colors.bleuNuit)
      .fillColor(BRAND.colors.grisClair)
      .rect(x, y, width, height)
      .fillAndStroke();

    let cursorY = y + padding;
    for (const r of rows) {
      doc
        .fillColor(BRAND.colors.grisFonce)
        .font(BRAND.fonts.body)
        .fontSize(9)
        .text(r.label, x + padding, cursorY, { width: width * 0.45 });
      doc
        .fillColor(BRAND.colors.bleuNuitDark)
        .font(BRAND.fonts.titre)
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
      .strokeColor(BRAND.colors.rouge)
      .stroke();
    // Bordure intérieure rouge fine (effet cachet officiel)
    doc
      .rect(x + 4, y + 4, width - 8, height - 8)
      .lineWidth(0.5)
      .strokeColor(BRAND.colors.rouge)
      .stroke();
    // Titre principal
    doc
      .fillColor(BRAND.colors.rouge)
      .font(BRAND.fonts.titre)
      .fontSize(13)
      .text('BUDGET GELÉ BCEAO', x, y + 18, {
        width,
        align: 'center',
        lineBreak: false,
      });
    // Sous-titre conservation
    doc
      .font(BRAND.fonts.body)
      .fontSize(9)
      .fillColor(BRAND.colors.rouge)
      .text('Conservation 10 ans', x, y + 40, {
        width,
        align: 'center',
        lineBreak: false,
      });
    // Référence audit_log
    doc
      .font(BRAND.fonts.body)
      .fontSize(8)
      .fillColor(BRAND.colors.grisFonce)
      .text(`Réf. audit ${referenceAudit}`, x, y + 62, {
        width,
        align: 'center',
        lineBreak: false,
      });
    // Mention cachet électronique
    doc
      .font(BRAND.fonts.italic)
      .fontSize(7)
      .fillColor(BRAND.colors.grisFonce)
      .text('Cachet électronique MIZNAS', x, y + 78, {
        width,
        align: 'center',
        lineBreak: false,
      });
    doc.restore();
  }

  /**
   * Dessine un tableau (header + lignes) avec **pagination défensive au
   * niveau ligne** (Lot 7.6.bis Palier 4 — fix défaut B).
   *
   * **Bug critique du Lot 7.6.bis Palier 3** : la version précédente
   * incrémentait `y` localement sans vérifier le débordement. À partir
   * de la 22ᵉ ligne du tableau "Détail comptes", `doc.text()` sans
   * `lineBreak: false` déclenchait l'auto-pagination de pdfkit, mais
   * la variable locale `y` continuait à croître sans se synchroniser.
   * Chaque `text()` suivant écrivait à Y >> pageHeight → cascade
   * d'addPage(). Résultat : PDF à 197 pages au lieu de 12, avec une
   * cellule par page.
   *
   * **Fix triple** :
   *   1. Avant chaque ligne, check `currentY + rowHeight > pageBottom`
   *      → si oui, `addPage()` + reset Y au top du contenu de la
   *      nouvelle page + redessin du header de tableau (continuité).
   *   2. `lineBreak: false` sur CHAQUE `text()` de cellule pour éviter
   *      l'auto-pagination interne pdfkit.
   *   3. `currentY` reste la source de vérité — `doc.y` n'est synchro
   *      qu'à la fin via `doc.y = currentY`.
   *
   * @returns la coordonnée `y` après la dernière ligne dessinée.
   */
  drawTable(
    doc: PDFKit.PDFDocument,
    columns: PdfTableColumn[],
    rows: string[][],
    options: PdfTableOptions = {},
  ): number {
    const headerBg = options.headerBg ?? BRAND.colors.bleuNuit;
    const headerColor = options.headerColor ?? BRAND.colors.blanc;
    const minRowHeight = options.rowHeight ?? 22;
    const fontSize = options.fontSize ?? 9;
    const totalWidth = columns.reduce((s, c) => s + c.width, 0);
    const cellPaddingV = 6;

    const x0 = doc.x;
    let currentY = doc.y;

    // **Lot 7.6.bis Palier 4** : override des marges haut/bas à 0
    // pour neutraliser l'auto-pagination pdfkit pendant le rendu.
    // La pagination est gérée manuellement au niveau LIGNE.
    const origMargins = { ...doc.page.margins };
    doc.page.margins = { ...origMargins, top: 0, bottom: 0 };
    try {
      // Header initial
      this.drawTableHeaderRow(
        doc,
        columns,
        x0,
        currentY,
        minRowHeight,
        fontSize,
        headerBg,
        headerColor,
        totalWidth,
      );
      currentY += minRowHeight;

      // Lignes — pagination défensive + hauteur DYNAMIQUE par ligne.
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];

        // **Lot 7.6.bis Palier 5 fix défaut A** : hauteur dynamique.
        // Mesurer `heightOfString` pour CHAQUE cellule avec les mêmes
        // contraintes (width, font, fontSize) que le `doc.text()` qui
        // suivra, puis prendre le max comme hauteur de ligne. Évite
        // que la ligne suivante recouvre une cellule au texte wrappé
        // (ex: commentaire E1 du tableau de traçabilité, 3 lignes).
        doc.font(BRAND.fonts.body).fontSize(fontSize);
        const cellHeights = columns.map((col, j) => {
          const text = row[j] ?? '';
          return doc.heightOfString(text, {
            width: col.width - 8,
            align: col.align ?? 'left',
          });
        });
        const actualRowHeight = Math.max(
          minRowHeight,
          ...cellHeights.map((h) => h + cellPaddingV * 2),
        );

        // Saut de page si la ligne ne tient pas (avec sa vraie hauteur).
        const pageBottom = doc.page.height - origMargins.bottom;
        if (currentY + actualRowHeight > pageBottom) {
          doc.addPage();
          currentY = origMargins.top;
          // addPage réinitialise les marges courantes — re-override.
          doc.page.margins = { ...doc.page.margins, top: 0, bottom: 0 };
          this.drawTableHeaderRow(
            doc,
            columns,
            x0,
            currentY,
            minRowHeight,
            fontSize,
            headerBg,
            headerColor,
            totalWidth,
          );
          currentY += minRowHeight;
        }

        // Bande alternée — utilise la hauteur DYNAMIQUE de la ligne.
        if (i % 2 === 1) {
          doc
            .save()
            .fillColor(BRAND.colors.grisClair)
            .rect(x0, currentY, totalWidth, actualRowHeight)
            .fill()
            .restore();
        }

        // Cellules — texte wrappable (PAS de lineBreak: false). L'auto-
        // pagination verticale est inhibée par l'override de marges,
        // donc seul le wrap horizontal s'applique → comportement
        // souhaité (cellule à 3 lignes dans la même ligne tableau).
        doc.font(BRAND.fonts.body).fontSize(fontSize);
        let cx = x0;
        for (let j = 0; j < columns.length; j++) {
          const col = columns[j];
          const value = row[j] ?? '';
          const style = options.cellStyle?.(i, j, value);
          if (style?.bg) {
            // Badge coloré centré verticalement dans la ligne.
            const badgeH = fontSize + 8;
            const badgeY = currentY + (actualRowHeight - badgeH) / 2;
            const badgeW = col.width - 10;
            doc
              .save()
              .fillColor(style.bg)
              .roundedRect(cx + 5, badgeY, badgeW, badgeH, 3)
              .fill()
              .restore();
            doc
              .fillColor(style.color ?? '#FFFFFF')
              .text(value, cx + 5, badgeY + 4, {
                width: badgeW,
                align: 'center',
                lineBreak: false,
              });
          } else {
            doc
              .font(style?.bold ? BRAND.fonts.titre : BRAND.fonts.body)
              .fillColor(style?.color ?? BRAND.colors.bleuNuitDark)
              .text(value, cx + 4, currentY + cellPaddingV, {
                width: col.width - 8,
                align: col.align ?? 'left',
              });
            doc.font(BRAND.fonts.body);
          }
          cx += col.width;
        }

        currentY += actualRowHeight;
      }
    } finally {
      doc.page.margins = origMargins;
    }

    doc.y = currentY;
    return currentY;
  }

  /**
   * Dessine la ligne d'en-tête d'un tableau à la coordonnée Y donnée.
   * Extrait du `drawTable` pour permettre le redessin en cas de saut
   * de page (continuité visuelle multi-page).
   */
  private drawTableHeaderRow(
    doc: PDFKit.PDFDocument,
    columns: PdfTableColumn[],
    x0: number,
    y: number,
    rowHeight: number,
    fontSize: number,
    headerBg: string,
    headerColor: string,
    totalWidth: number,
  ): void {
    doc.save().fillColor(headerBg).rect(x0, y, totalWidth, rowHeight).fill();
    doc.fillColor(headerColor).font(BRAND.fonts.titre).fontSize(fontSize);
    let cx = x0;
    for (const col of columns) {
      doc.text(col.header, cx + 4, y + 6, {
        width: col.width - 8,
        align: col.align ?? 'left',
        lineBreak: false,
      });
      cx += col.width;
    }
    doc.restore();
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
   * fait par l'appelant).
   *
   * **Bug critique fix Lot 7.6.bis Palier 4 (défaut B amplifié)** :
   * dans Palier 1, on positionnait `footerY = page.height - 35`. Cette
   * coordonnée tombe DANS la marge basse (marges.bas = 60 → la zone
   * utile s'arrête à `page.height - 60`). Même avec `lineBreak: false`,
   * pdfkit considère que `doc.text()` à Y > pageBottom déclenche
   * l'auto-pagination — résultat : 3 `text()` du footer × N pages =
   * cascade explosive (37 pages pour un PDF de 1 page de garde + 0
   * contenu détaillé, observé via debug-pdf2.js).
   *
   * **Fix Palier 4** :
   *   1. `_setMargins` temporaire (override la marge basse à 0) pour
   *      permettre l'écriture dans la zone réservée au footer
   *   2. ou positionner Y JUSTE DANS la zone utile (`pageBottom - 15`)
   *      pour rester valide tout en visuellement bas de page
   * Choix : approche #2 (plus simple, pas de side-effects sur les
   * options pdfkit).
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
    const left = BRAND.marges.gauche;
    const right = pageWidth - BRAND.marges.droite;
    const width = right - left;
    const footerY = doc.page.height - 35;

    // **Fix Lot 7.6.bis Palier 4** : `lineBreak: false` ne suffit pas
    // à empêcher l'auto-pagination quand `doc.text()` écrit en dessous
    // de `pageBottom = page.height - marges.bas`. Solution éprouvée :
    // override temporaire des marges haut/bas à 0 pendant l'écriture
    // du footer, puis restore. Pas de side-effect car on est dans
    // `doc.save()`/`doc.restore()` (mais on doit save/restore les
    // marges manuellement car save() ne les inclut pas).
    const origMargins = { ...doc.page.margins };
    doc.page.margins = { ...origMargins, top: 0, bottom: 0 };

    doc
      .save()
      .lineWidth(0.5)
      .strokeColor(BRAND.colors.or)
      .moveTo(left, footerY - 6)
      .lineTo(right, footerY - 6)
      .stroke();
    doc
      .fillColor(BRAND.colors.grisFonce)
      .font(BRAND.fonts.body)
      .fontSize(BRAND.fontSizes.footer);
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

    // Restaure les marges originales pour ne pas impacter les
    // futurs `doc.text()` (ex: header sur cette même page).
    doc.page.margins = origMargins;
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
    const left = BRAND.marges.gauche;
    const right = pageWidth - BRAND.marges.droite;
    const width = right - left;
    const headerY = 22;

    // **Fix Lot 7.6.bis Palier 4** — même cause que `drawFooterOnCurrentPage` :
    // `headerY = 22` est dans la marge HAUTE (marges.haut = 50), donc
    // `doc.text()` déclenche l'auto-pagination même avec `lineBreak: false`.
    // Override temporaire des marges à 0 pendant l'écriture.
    const origMargins = { ...doc.page.margins };
    doc.page.margins = { ...origMargins, top: 0, bottom: 0 };

    doc
      .save()
      .fillColor(BRAND.colors.grisFonce)
      .font(BRAND.fonts.body)
      .fontSize(BRAND.fontSizes.header);
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
      .strokeColor(BRAND.colors.or)
      .moveTo(left, headerY + 12)
      .lineTo(right, headerY + 12)
      .stroke();
    doc.restore();

    doc.page.margins = origMargins;
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
    const pageBottom = doc.page.height - BRAND.marges.bas;
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
      .fillColor(BRAND.colors.bleuNuit)
      .font(BRAND.fonts.titre)
      .fontSize(BRAND.fontSizes.section)
      .text(title);
    const y = doc.y + 2;
    doc
      .save()
      .lineWidth(1.5)
      .strokeColor(BRAND.colors.or)
      .moveTo(BRAND.marges.gauche, y)
      .lineTo(BRAND.marges.gauche + 60, y)
      .stroke()
      .restore();
    doc.moveDown(0.6);
    return doc.y;
  }

  // ─── SOUS-LOT 2 — Identité institutionnelle ──────────────────────

  /**
   * Page de garde institutionnelle : bandeau bleu nuit + filet or,
   * logo centré, titre + sous-titre, période en grand, destinataire,
   * encadré métadonnées et mention de confidentialité en bas.
   */
  drawCoverPage(
    doc: PDFKit.PDFDocument,
    opts: {
      title: string;
      subtitle: string;
      periodeGrande: string;
      destinataire: string;
      metaRows: Array<{ label: string; value: string }>;
      confidentialMention: string;
      /** Lot B2 — branding banque (défaut BSIC NIGER). */
      bank?: BankBranding;
    },
  ): void {
    const pageW = doc.page.width;
    const left = BRAND.marges.gauche;
    const widthDispo = pageW - left - BRAND.marges.droite;
    const bank = opts.bank ?? DEFAULT_BANK_BRANDING;

    // Bandeau supérieur (couleur primaire) + filet secondaire.
    doc
      .save()
      .fillColor(bank.couleurPrimaire)
      .rect(0, 0, pageW, 90)
      .fill()
      .restore();
    doc
      .save()
      .lineWidth(2)
      .strokeColor(bank.couleurSecondaire)
      .moveTo(0, 90)
      .lineTo(pageW, 90)
      .stroke()
      .restore();

    // Logo centré sous le bandeau.
    this.drawLogoPlaceholder(doc, (pageW - 150) / 2, 130, 150, 70, bank);

    // Titre principal.
    doc
      .fillColor(bank.couleurPrimaire)
      .font(BRAND.fonts.titre)
      .fontSize(30)
      .text(opts.title, left, 245, {
        width: widthDispo,
        align: 'center',
        lineBreak: false,
      });
    // Sous-titre (couleur secondaire).
    doc
      .fillColor(bank.couleurSecondaire)
      .font(BRAND.fonts.titre)
      .fontSize(16)
      .text(opts.subtitle, left, 288, {
        width: widthDispo,
        align: 'center',
        lineBreak: false,
      });

    // Séparateur court centré (couleur secondaire).
    doc
      .save()
      .lineWidth(1.5)
      .strokeColor(bank.couleurSecondaire)
      .moveTo(pageW / 2 - 45, 324)
      .lineTo(pageW / 2 + 45, 324)
      .stroke()
      .restore();

    // Période en grand (SOUS-LOT 3 ajust. 1 — aération renforcée).
    doc
      .fillColor(bank.couleurPrimaireDark)
      .font(BRAND.fonts.titre)
      .fontSize(22)
      .text(opts.periodeGrande, left, 350, {
        width: widthDispo,
        align: 'center',
        lineBreak: false,
      });

    // Destinataire (ligne centrée) — grand écart après la période.
    doc
      .fillColor(BRAND.colors.grisFonce)
      .font(BRAND.fonts.italic)
      .fontSize(BRAND.fontSizes.body)
      .text(opts.destinataire, left, 420, {
        width: widthDispo,
        align: 'center',
      });

    // Encadré métadonnées centré — écart après le destinataire.
    const boxW = 360;
    this.drawInfoBox(doc, (pageW - boxW) / 2, 480, boxW, opts.metaRows);

    // Mention de confidentialité en bas.
    doc
      .fillColor(BRAND.colors.grisFonce)
      .font(BRAND.fonts.italic)
      .fontSize(8)
      .text(opts.confidentialMention, left, doc.page.height - 90, {
        width: widthDispo,
        align: 'center',
      });
  }

  /**
   * En-tête charté (bandeau couleur primaire + filet secondaire) sur
   * TOUTES les pages. Nom banque à gauche, titre centré, période à
   * droite — en blanc sur le bandeau. Lot PDF-V2 : couvre la page 1
   * (plus de page de garde à exclure).
   */
  applyChartedHeaderToAllPages(
    doc: PDFKit.PDFDocument,
    parts: { titre: string; periode: string },
    bank: BankBranding = DEFAULT_BANK_BRANDING,
  ): void {
    const range = doc.bufferedPageRange();
    const total = range.count;
    for (let i = 0; i < total; i++) {
      doc.switchToPage(range.start + i);
      this.drawChartedHeaderOnCurrentPage(doc, parts, bank);
    }
  }

  private drawChartedHeaderOnCurrentPage(
    doc: PDFKit.PDFDocument,
    parts: { titre: string; periode: string },
    bank: BankBranding,
  ): void {
    const pageW = doc.page.width;
    const h = 30;
    const orig = { ...doc.page.margins };
    doc.page.margins = { ...orig, top: 0, bottom: 0 };

    doc
      .save()
      .fillColor(bank.couleurPrimaire)
      .rect(0, 0, pageW, h)
      .fill()
      .restore();
    doc
      .save()
      .lineWidth(1)
      .strokeColor(bank.couleurSecondaire)
      .moveTo(0, h)
      .lineTo(pageW, h)
      .stroke()
      .restore();

    const left = BRAND.marges.gauche;
    const width = pageW - left - BRAND.marges.droite;
    doc
      .fillColor('#FFFFFF')
      .font(BRAND.fonts.titre)
      .fontSize(9)
      .text(bank.nom, left, 10, {
        width: width / 3,
        align: 'left',
        lineBreak: false,
      });
    doc
      .font(BRAND.fonts.body)
      .fontSize(9)
      .text(parts.titre, left + width / 3, 10, {
        width: width / 3,
        align: 'center',
        lineBreak: false,
      });
    doc.fontSize(8).text(parts.periode, left + (2 * width) / 3, 11, {
      width: width / 3,
      align: 'right',
      lineBreak: false,
    });
    doc.page.margins = orig;
  }

  /**
   * Pied de page charté (bandeau bleu nuit) sur toutes les pages
   * (option skipFirstPage pour la garde). Confidentiel à gauche,
   * « Document MIZNAS » au centre, pagination à droite — en blanc.
   */
  applyChartedFooterToAllPages(
    doc: PDFKit.PDFDocument,
    parts: { left: string; center: string },
    options: { skipFirstPage?: boolean } = {},
    bank: BankBranding = DEFAULT_BANK_BRANDING,
  ): void {
    const range = doc.bufferedPageRange();
    const total = range.count;
    for (let i = 0; i < total; i++) {
      if (options.skipFirstPage && i === 0) continue;
      doc.switchToPage(range.start + i);
      this.drawChartedFooterOnCurrentPage(doc, {
        left: parts.left,
        center: parts.center,
        pageNumber: i + 1,
        totalPages: total,
        bank,
      });
    }
  }

  private drawChartedFooterOnCurrentPage(
    doc: PDFKit.PDFDocument,
    parts: {
      left: string;
      center: string;
      pageNumber: number;
      totalPages: number;
      bank: BankBranding;
    },
  ): void {
    const pageW = doc.page.width;
    const h = 24;
    const bandY = doc.page.height - h;
    const orig = { ...doc.page.margins };
    doc.page.margins = { ...orig, top: 0, bottom: 0 };

    doc
      .save()
      .fillColor(parts.bank.couleurPrimaire)
      .rect(0, bandY, pageW, h)
      .fill()
      .restore();
    doc
      .save()
      .lineWidth(1)
      .strokeColor(parts.bank.couleurSecondaire)
      .moveTo(0, bandY)
      .lineTo(pageW, bandY)
      .stroke()
      .restore();

    const left = BRAND.marges.gauche;
    const width = pageW - left - BRAND.marges.droite;
    const ty = bandY + 8;
    doc.fillColor('#FFFFFF').font(BRAND.fonts.body).fontSize(7);
    doc.text(parts.left, left, ty, {
      width: width / 3,
      align: 'left',
      lineBreak: false,
    });
    doc.text(parts.center, left + width / 3, ty, {
      width: width / 3,
      align: 'center',
      lineBreak: false,
    });
    doc.text(
      `Page ${String(parts.pageNumber)}/${String(parts.totalPages)}`,
      left + (2 * width) / 3,
      ty,
      { width: width / 3, align: 'right', lineBreak: false },
    );
    doc.page.margins = orig;
  }

  // ─── SOUS-LOT 3 — Bandeaux de section + badges ───────────────────

  /**
   * Bandeau de section : rectangle plein pleine-largeur (marges) avec
   * titre en blanc + filet inférieur. Couleur par défaut bleu nuit BSIC
   * (passer l'or pour distinguer une section IA/approbations). Positionne
   * `doc.y` sous le bandeau et retourne cette coordonnée.
   */
  drawColoredBanner(
    doc: PDFKit.PDFDocument,
    title: string,
    opts: { bg?: string; height?: number; textColor?: string } = {},
  ): number {
    const bg = opts.bg ?? BRAND.colors.bleuNuit;
    const textColor = opts.textColor ?? '#FFFFFF';
    const h = opts.height ?? 26;
    const left = BRAND.marges.gauche;
    const width = doc.page.width - left - BRAND.marges.droite;
    const y = doc.y;

    doc.save().fillColor(bg).rect(left, y, width, h).fill().restore();
    // Filet or fin sous le bandeau (accent charte).
    doc
      .save()
      .lineWidth(1)
      .strokeColor(BRAND.colors.or)
      .moveTo(left, y + h)
      .lineTo(left + width, y + h)
      .stroke()
      .restore();
    doc
      .fillColor(textColor)
      .font(BRAND.fonts.titre)
      .fontSize(BRAND.fontSizes.sousSection)
      .text(title.toUpperCase(), left + 10, y + h / 2 - 6, {
        width: width - 20,
        lineBreak: false,
      });
    doc.y = y + h + 12;
    doc.x = left;
    return doc.y;
  }

  /**
   * Badge rectangulaire (coins légèrement arrondis) fond coloré + texte
   * blanc centré. Utilisé pour les niveaux d'alerte et les taux/badges
   * de conformité. Retourne la largeur dessinée.
   */
  drawBadge(
    doc: PDFKit.PDFDocument,
    x: number,
    y: number,
    text: string,
    bg: string,
    opts: { width?: number; textColor?: string; fontSize?: number } = {},
  ): number {
    const fontSize = opts.fontSize ?? 8;
    const w =
      opts.width ??
      doc.font(BRAND.fonts.titre).fontSize(fontSize).widthOfString(text) + 14;
    const h = fontSize + 8;
    doc.save().fillColor(bg).roundedRect(x, y, w, h, 3).fill().restore();
    doc
      .fillColor(opts.textColor ?? '#FFFFFF')
      .font(BRAND.fonts.titre)
      .fontSize(fontSize)
      .text(text, x, y + 4, { width: w, align: 'center', lineBreak: false });
    return w;
  }
}
