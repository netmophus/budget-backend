/**
 * ExportPdfService (Lot 8.6.B) — orchestre la génération du PDF
 * « Analyse Budget vs Réalisé » :
 *  1. Reçoit la EcartsResponseDto déjà calculée par le caller
 *     (TableauBordController) + un éventuel snapshot d'analyse
 *     MIZNAS AI fourni par le frontend.
 *  2. Crée un PDFDocument via PdfBuilderService.createDocument()
 *     (charte BSIC + bufferPages requis pour le footer paginé).
 *  3. Délègue à `buildTableauBordAnalysePdf` le rendu des 3-4 pages.
 *  4. Applique le footer paginé sur toutes les pages.
 *  5. Termine le doc et retourne le Buffer assemblé.
 *
 * Stateless — réutilisable par d'autres endpoints futurs (export PDF
 * d'autres sous-vues du dashboard).
 */
import { Injectable } from '@nestjs/common';

import { PdfBuilderService } from '../../reporting/generators/pdf-builder.service';
import type { EcartsResponseDto } from '../dto/tableau-bord.dto';
import {
  buildTableauBordAnalysePdf,
  type AnalyseAiSnapshot,
  type TableauBordAnalyseData,
} from '../templates/tableau-bord-analyse.template';

export interface ExportPdfMetadata {
  codeVersion: string;
  codeScenario: string;
  crsLibelles: string[];
  userEmail: string;
}

@Injectable()
export class ExportPdfService {
  constructor(private readonly pdfBuilder: PdfBuilderService) {}

  /**
   * Génère le PDF. Le caller fournit déjà la EcartsResponseDto pour
   * éviter une 2e requête SQL (cohérent avec le controller qui appelle
   * `analyseSvc.getBudgetVsRealise` puis ce service).
   *
   * Retourne un Buffer. Pas de stream direct ici — c'est le controller
   * qui pose les headers HTTP + appelle `res.end(buffer)`.
   */
  async genererPdf(
    ecarts: EcartsResponseDto,
    metadata: ExportPdfMetadata,
    analyseIa?: AnalyseAiSnapshot,
  ): Promise<Buffer> {
    const doc = this.pdfBuilder.createDocument({
      title: 'Analyse Budget vs Réalisé — MIZNAS',
      subject: `Analyse ${metadata.codeVersion} — ${ecarts.filtres.moisDebut} → ${ecarts.filtres.moisFin}`,
    });

    const data: TableauBordAnalyseData = {
      ecarts,
      metadata: {
        codeVersion: metadata.codeVersion,
        codeScenario: metadata.codeScenario,
        crsLibelles: metadata.crsLibelles,
        userEmail: metadata.userEmail,
        generatedAt: new Date().toISOString(),
      },
      analyseIa,
    };

    buildTableauBordAnalysePdf(doc, data, this.pdfBuilder);

    // En-tête + pied chartés (SOUS-LOT 2.2) — appels obligatoires AVANT
    // doc.end() sinon bufferedPageRange() retourne 0 (cf. Lot 7.6.bis).
    // La page de garde (page 1) est exclue des deux bandeaux.
    const periode = `${ecarts.filtres.moisDebut} -> ${ecarts.filtres.moisFin}`;
    this.pdfBuilder.applyChartedHeaderToAllPagesExceptFirst(doc, {
      titre: 'ANALYSE BUDGÉTAIRE',
      periode,
    });
    this.pdfBuilder.applyChartedFooterToAllPages(
      doc,
      {
        left: 'CONFIDENTIEL - BSIC NIGER',
        center: 'Document MIZNAS',
      },
      { skipFirstPage: true },
    );

    // Capture du Buffer via stream pdfkit.
    return new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', (err: unknown) =>
        reject(err instanceof Error ? err : new Error(String(err))),
      );
      doc.end();
    });
  }
}
