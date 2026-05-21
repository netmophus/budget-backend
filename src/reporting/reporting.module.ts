/**
 * ReportingModule (Lot 7.6) — module transverse pour la génération de
 * rapports MIZNAS officiels (R01–R20).
 *
 * Au Lot 7.6, expose uniquement les 2 generators (pdfkit + exceljs)
 * réutilisables. Le service métier `R04BudgetBceaoService` et son
 * controller seront ajoutés aux paliers suivants.
 */
import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { ExcelBuilderService } from './generators/excel-builder.service';
import { PdfBuilderService } from './generators/pdf-builder.service';
import { ReportingController } from './reporting.controller';
import { R04BudgetBceaoService } from './services/r04-budget-bceao.service';

@Module({
  imports: [AuditModule],
  controllers: [ReportingController],
  providers: [PdfBuilderService, ExcelBuilderService, R04BudgetBceaoService],
  exports: [PdfBuilderService, ExcelBuilderService, R04BudgetBceaoService],
})
export class ReportingModule {}
