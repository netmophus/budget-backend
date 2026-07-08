import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AiModule } from '../ai/ai.module';
import { AnalyseIaModule } from '../analyse-ia/analyse-ia.module';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { BudgetModule } from '../budget/budget.module';
import { ConfigurationBanqueModule } from '../configuration-banque/configuration-banque.module';
import { DimCentreResponsabilite } from '../referentiels/centre-responsabilite/entities/dim-centre-responsabilite.entity';
import { DimLigneMetier } from '../referentiels/ligne-metier/entities/dim-ligne-metier.entity';
import { ReportingModule } from '../reporting/reporting.module';
import { AnalyseEcartsService } from './services/analyse-ecarts.service';
import { ExportExcelService } from './services/export-excel.service';
import { ExportPdfService } from './services/export-pdf.service';
import { StructureOrganisationnelleService } from './services/structure-organisationnelle.service';
import { AnalyseIaPdfController } from './analyse-ia-pdf.controller';
import { TableauBordController } from './tableau-bord.controller';

/**
 * TableauBordModule (Lot 5.2) — agrégation budget vs réalisé +
 * export Excel. Réutilise PerimetreService de BudgetModule pour
 * le filtrage RBAC (cohérent avec RealiseModule du Lot 5.1).
 *
 * Lot 8.6.A — héberge en plus l'endpoint POST /analyse-ai qui
 * orchestre AiModule (AnthropicService + rate limiter) +
 * AuditModule (1 ligne audit_log AI_ANALYSE_DEMANDEE par appel).
 */
@Module({
  imports: [
    AuthModule,
    BudgetModule,
    AiModule,
    AuditModule,
    ReportingModule, // Lot 8.6.B — pour PdfBuilderService
    ConfigurationBanqueModule, // Lot B2 — branding banque
    AnalyseIaModule, // Chantier C1 — persistance des analyses IA
    // Chantier A — dims CR/LM pour la structure organisationnelle du prompt.
    TypeOrmModule.forFeature([DimCentreResponsabilite, DimLigneMetier]),
  ],
  controllers: [TableauBordController, AnalyseIaPdfController],
  providers: [
    AnalyseEcartsService,
    ExportExcelService,
    ExportPdfService,
    StructureOrganisationnelleService,
  ],
  exports: [AnalyseEcartsService],
})
export class TableauBordModule {}
