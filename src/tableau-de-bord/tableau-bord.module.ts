import { Module } from '@nestjs/common';

import { AiModule } from '../ai/ai.module';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { BudgetModule } from '../budget/budget.module';
import { AnalyseEcartsService } from './services/analyse-ecarts.service';
import { ExportExcelService } from './services/export-excel.service';
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
  imports: [AuthModule, BudgetModule, AiModule, AuditModule],
  controllers: [TableauBordController],
  providers: [AnalyseEcartsService, ExportExcelService],
  exports: [AnalyseEcartsService],
})
export class TableauBordModule {}
