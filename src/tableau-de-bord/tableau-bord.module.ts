import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { BudgetModule } from '../budget/budget.module';
import { AnalyseEcartsService } from './services/analyse-ecarts.service';
import { ExportExcelService } from './services/export-excel.service';
import { TableauBordController } from './tableau-bord.controller';

/**
 * TableauBordModule (Lot 5.2) — agrégation budget vs réalisé +
 * export Excel. Réutilise PerimetreService de BudgetModule pour
 * le filtrage RBAC (cohérent avec RealiseModule du Lot 5.1).
 */
@Module({
  imports: [AuthModule, BudgetModule],
  controllers: [TableauBordController],
  providers: [AnalyseEcartsService, ExportExcelService],
  exports: [AnalyseEcartsService],
})
export class TableauBordModule {}
