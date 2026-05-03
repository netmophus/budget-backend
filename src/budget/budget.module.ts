import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { DimCentreResponsabilite } from '../referentiels/centre-responsabilite/entities/dim-centre-responsabilite.entity';
import { DimCompte } from '../referentiels/compte/entities/dim-compte.entity';
import { DimScenario } from '../referentiels/scenario/entities/dim-scenario.entity';
import { DimTemps } from '../referentiels/temps/entities/dim-temps.entity';
import { DimVersion } from '../referentiels/version/entities/dim-version.entity';
import { FaitBudget } from '../faits/budget/entities/fait-budget.entity';
import { UserRole } from '../users/entities/user-role.entity';
import { BudgetGrilleController } from './controllers/budget-grille.controller';
import { BudgetSaisieService } from './services/budget-saisie.service';
import { PerimetreService } from './services/perimetre.service';

/**
 * BudgetModule (Lot 3.3) — porte les services applicatifs transverses
 * du module budgétaire. Pour l'instant : PerimetreService (filtrage
 * RBAC par structure pour la décision Q5).
 *
 * BudgetSaisieService (orchestration grille de saisie) est ajouté à
 * la Phase C — il consomme PerimetreService et FaitBudgetService.
 *
 * Le module n'importe **pas** FaitBudgetModule pour éviter une
 * dépendance circulaire ; à la place, c'est FaitBudgetModule qui
 * importe BudgetModule pour consommer PerimetreService.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      UserRole,
      FaitBudget,
      DimCompte,
      DimTemps,
      DimCentreResponsabilite,
      DimVersion,
      DimScenario,
    ]),
    AuditModule,
    AuthModule,
  ],
  controllers: [BudgetGrilleController],
  providers: [PerimetreService, BudgetSaisieService],
  exports: [PerimetreService, BudgetSaisieService],
})
export class BudgetModule {}
