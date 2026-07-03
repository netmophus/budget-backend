/**
 * ExcelBuilderService (Lot 7.6) — helper autour d'ExcelJS pour la
 * génération de workbooks MIZNAS.
 *
 * Réutilisable par les ~20 rapports à venir (R01–R20). Encapsule la
 * charte BSIC NIGER côté tableur (couleurs cellules, polices,
 * formats de nombres FCFA, en-têtes stylés).
 */
import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';

import { BRAND } from './pdf-builder.service';

/** Couleurs ARGB (ExcelJS) dérivées de la charte BSIC. */
export const BSIC_EXCEL_COLORS = {
  bleuNuit: 'FF1B2A4E',
  blanc: 'FFFFFFFF',
  vertClair: 'FFE6F4EE',
  orangeClair: 'FFFCEFE0',
  grisClair: 'FFF4F6F8',
  grisBordure: 'FFCBD2D9',
} as const;

@Injectable()
export class ExcelBuilderService {
  /**
   * Crée un workbook MIZNAS pré-configuré (creator + props).
   * Le caller ajoute ensuite ses worksheets via `wb.addWorksheet()`.
   */
  createWorkbook(meta: {
    title: string;
    subject?: string;
    /** Lot B2 — nom banque (creator/company). Défaut BSIC NIGER. */
    bankNom?: string;
  }): ExcelJS.Workbook {
    const nom = meta.bankNom ?? 'BSIC NIGER';
    const wb = new ExcelJS.Workbook();
    wb.creator = `MIZNAS — ${nom}`;
    wb.created = new Date();
    wb.title = meta.title;
    wb.subject = meta.subject ?? meta.title;
    wb.company = `${nom} S.A.`;
    return wb;
  }

  /**
   * Style en-tête de tableau (ligne 1 par défaut) : fond bleu nuit,
   * texte blanc, gras, centré. La largeur des colonnes est fixée par
   * le caller via `ws.columns = [...]` avant l'appel.
   */
  styleHeaderRow(
    row: ExcelJS.Row,
    options: { bg?: string; color?: string } = {},
  ): void {
    row.eachCell((cell) => {
      cell.font = {
        name: BRAND.fonts.titre,
        bold: true,
        color: { argb: options.color ?? BSIC_EXCEL_COLORS.blanc },
        size: 11,
      };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: options.bg ?? BSIC_EXCEL_COLORS.bleuNuit },
      };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = {
        top: { style: 'thin', color: { argb: BSIC_EXCEL_COLORS.grisBordure } },
        bottom: {
          style: 'thin',
          color: { argb: BSIC_EXCEL_COLORS.grisBordure },
        },
        left: { style: 'thin', color: { argb: BSIC_EXCEL_COLORS.grisBordure } },
        right: {
          style: 'thin',
          color: { argb: BSIC_EXCEL_COLORS.grisBordure },
        },
      };
    });
    row.height = 22;
  }

  /**
   * Style ligne de total / sous-total : gras + fond gris (par défaut)
   * ou couleur custom. Applique des bordures top épaisse + bottom fine.
   */
  styleTotalRow(
    row: ExcelJS.Row,
    options: { bg?: string; color?: string; bold?: boolean } = {},
  ): void {
    const bg = options.bg ?? BSIC_EXCEL_COLORS.grisClair;
    const color = options.color;
    row.eachCell((cell) => {
      cell.font = {
        name: BRAND.fonts.body,
        bold: options.bold ?? true,
        color: color ? { argb: color } : undefined,
        size: 11,
      };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: bg },
      };
      cell.border = {
        top: { style: 'medium' },
        bottom: { style: 'thin' },
      };
    });
  }

  /**
   * Format monétaire FCFA — séparateur de milliers + 0 décimales.
   * Applique le format à toutes les cellules d'une plage de colonnes.
   */
  applyFcfaFormat(
    ws: ExcelJS.Worksheet,
    columnLetters: string[],
    startRow = 2,
  ): void {
    const fmt = '#,##0';
    const endRow = ws.rowCount;
    for (const letter of columnLetters) {
      for (let r = startRow; r <= endRow; r++) {
        ws.getCell(`${letter}${r}`).numFmt = fmt;
      }
    }
  }

  /**
   * Ajoute une bande de couleur fine sur toute une ligne (utile pour
   * distinguer visuellement les classes 6 vs 7 dans le détail comptes).
   */
  fillRow(row: ExcelJS.Row, argbColor: string): void {
    row.eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: argbColor },
      };
    });
  }

  /**
   * Sérialise le workbook en Buffer Node.js, prêt à être renvoyé par
   * un controller NestJS via `res.send(buffer)`.
   */
  async toBuffer(wb: ExcelJS.Workbook): Promise<Buffer> {
    const ab = await wb.xlsx.writeBuffer();
    return Buffer.from(ab);
  }
}
