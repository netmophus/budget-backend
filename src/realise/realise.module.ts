import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { BudgetModule } from '../budget/budget.module';
import { FaitRealise } from './entities/fait-realise.entity';
import { RealiseController } from './realise.controller';
import { RealiseImportService } from './services/realise-import.service';
import { RealiseService } from './services/realise.service';

/**
 * RealiseModule (Lot 5.1) — module métier "réalisé budgétaire".
 *
 * Réutilise PerimetreService de BudgetModule pour le filtrage RBAC
 * (CR autorisés via user_perimetres) en écriture.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([FaitRealise]),
    AuditModule,
    AuthModule,
    BudgetModule, // pour PerimetreService
  ],
  controllers: [RealiseController],
  providers: [RealiseService, RealiseImportService],
  exports: [RealiseService],
})
export class RealiseModule {}
