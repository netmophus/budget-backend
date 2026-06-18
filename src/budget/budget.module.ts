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
import { UserPerimetre } from '../users/entities/user-perimetre.entity';
import { UserRole } from '../users/entities/user-role.entity';
import { BudgetGrilleController } from './controllers/budget-grille.controller';
import { BudgetImportController } from './controllers/budget-import.controller';
import { IndicateursController } from './controllers/indicateurs.controller';
import { MePerimetreController } from './controllers/me-perimetre.controller';
import { VersionsResumeController } from './controllers/versions-resume.controller';
import {
  CrWorkflowController,
  VersionComiteController,
} from './cr-workflow/cr-workflow.controller';
import { CrWorkflowService } from './cr-workflow/cr-workflow.service';
import { DimVersionCrAttendu } from './cr-workflow/entities/dim-version-cr-attendu.entity';
import { FaitBudgetCrStatut } from './cr-workflow/entities/fait-budget-cr-statut.entity';
import { BudgetImportService } from './services/budget-import.service';
import { BudgetSaisieService } from './services/budget-saisie.service';
import { IndicateursHomeService } from './services/indicateurs-home.service';
import { IndicateursService } from './services/indicateurs.service';
import { PerimetreService } from './services/perimetre.service';
import { VersionsResumeService } from './services/versions-resume.service';

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
      UserPerimetre,
      FaitBudget,
      DimCompte,
      DimTemps,
      DimCentreResponsabilite,
      DimVersion,
      DimScenario,
      FaitBudgetCrStatut,
      DimVersionCrAttendu,
    ]),
    AuditModule,
    AuthModule,
  ],
  controllers: [
    BudgetGrilleController,
    IndicateursController,
    BudgetImportController,
    VersionsResumeController,
    MePerimetreController,
    CrWorkflowController,
    VersionComiteController,
  ],
  providers: [
    PerimetreService,
    BudgetSaisieService,
    IndicateursService,
    IndicateursHomeService,
    BudgetImportService,
    VersionsResumeService,
    CrWorkflowService,
  ],
  exports: [
    PerimetreService,
    BudgetSaisieService,
    IndicateursService,
    IndicateursHomeService,
    BudgetImportService,
    VersionsResumeService,
  ],
})
export class BudgetModule {}
