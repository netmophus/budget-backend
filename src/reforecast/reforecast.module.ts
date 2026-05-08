import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { BudgetModule } from '../budget/budget.module';
import { DimVersion } from '../referentiels/version/entities/dim-version.entity';
import { VersionModule } from '../referentiels/version/version.module';
import { ReforecastController } from './reforecast.controller';
import { ReforecastService } from './reforecast.service';

/**
 * ReforecastModule (Lot 5.3.A) — module porteur du reforecast
 * trimestriel. Réutilise :
 *  - VersionModule : pour le VersionWorkflowService (transitions
 *    workflow ouvert→soumis→valide→gele) ;
 *  - BudgetModule : pour BudgetSaisieService (grille de saisie
 *    réutilisée à `GET /reforecast/:id/grille`).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([DimVersion]),
    AuditModule,
    AuthModule,
    VersionModule,
    BudgetModule,
  ],
  controllers: [ReforecastController],
  providers: [ReforecastService],
  exports: [ReforecastService],
})
export class ReforecastModule {}
