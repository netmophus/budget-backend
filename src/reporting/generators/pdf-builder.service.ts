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
 * Charte BSIC NIGER — palette et conventions utilisées pour TOUS les
 * rapports MIZNAS. Source : Charte v1 + maquette R04 validée Lot 7.6.
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
  },
  fonts: {
    titre: 'Helvetica-Bold',
    body: 'Helvetica',
    italic: 'Helvetica-Oblique',
  },
  marges: {
    haut: 50,
    bas: 60,
    gauche: 50,
    droite: 50,
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
   * Placeholder pour le logo BSIC NIGER. Tant qu'un fichier image n'est
   * pas fourni (assets/logo-bsic.png ou équivalent), on dessine un
   * encadré bleu nuit avec "[BSIC NIGER]" — visuellement reconnaissable.
   */
  drawLogoPlaceholder(
    doc: PDFKit.PDFDocument,
    x: number,
    y: number,
    width = 120,
    height = 40,
  ): void {
    doc
      .save()
      .lineWidth(1)
      .strokeColor(BSIC_BRAND.colors.bleuNuit)
      .rect(x, y, width, height)
      .stroke();
    doc
      .fillColor(BSIC_BRAND.colors.bleuNuit)
      .font(BSIC_BRAND.fonts.titre)
      .fontSize(11)
      .text('[BSIC NIGER]', x, y + height / 2 - 6, {
        width,
        align: 'center',
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
   * Cachet stylisé "BUDGET GELÉ BCEAO 10 ANS" — encadré or sur fond
   * crème. Utilisé en page 2 du R04 (référence audit + validation).
   */
  drawBceaoStamp(
    doc: PDFKit.PDFDocument,
    x: number,
    y: number,
    width: number,
    referenceAudit: string,
  ): void {
    const height = 72;
    doc
      .save()
      .lineWidth(2)
      .strokeColor(BSIC_BRAND.colors.or)
      .fillColor('#FBF6E9')
      .rect(x, y, width, height)
      .fillAndStroke();
    doc
      .fillColor(BSIC_BRAND.colors.bleuNuit)
      .font(BSIC_BRAND.fonts.titre)
      .fontSize(13)
      .text('BUDGET GELÉ BCEAO 10 ANS', x, y + 12, {
        width,
        align: 'center',
      });
    doc
      .fillColor(BSIC_BRAND.colors.grisFonce)
      .font(BSIC_BRAND.fonts.body)
      .fontSize(9)
      .text(`Référence audit : ${referenceAudit}`, x, y + 35, {
        width,
        align: 'center',
      });
    doc
      .fillColor(BSIC_BRAND.colors.vert)
      .font(BSIC_BRAND.fonts.titre)
      .fontSize(9)
      .text('Validation cryptographique : OK', x, y + 52, {
        width,
        align: 'center',
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
   * Ajoute le footer paginé sur toutes les pages du document. À
   * appeler APRÈS avoir tout dessiné mais AVANT `doc.end()`, sinon
   * `bufferedPageRange()` retourne 0 pages.
   *
   * Format : "Gauche | Centre | Droite (Page X/N)".
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

      const y = doc.page.height - BSIC_BRAND.marges.bas + 15;
      const left = BSIC_BRAND.marges.gauche;
      const right = doc.page.width - BSIC_BRAND.marges.droite;
      const width = right - left;

      doc
        .save()
        .lineWidth(0.5)
        .strokeColor(BSIC_BRAND.colors.grisFonce)
        .moveTo(left, y - 5)
        .lineTo(right, y - 5)
        .stroke();
      doc
        .fillColor(BSIC_BRAND.colors.grisFonce)
        .font(BSIC_BRAND.fonts.body)
        .fontSize(8);
      doc.text(parts.left, left, y, { width: width / 3, align: 'left' });
      doc.text(parts.center, left + width / 3, y, {
        width: width / 3,
        align: 'center',
      });
      doc.text(`Page ${i + 1}/${total}`, left + (2 * width) / 3, y, {
        width: width / 3,
        align: 'right',
      });
      doc.restore();
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
      .fontSize(14)
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
