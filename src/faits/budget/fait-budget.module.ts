import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../../auth/auth.module';
import { CentreResponsabiliteModule } from '../../referentiels/centre-responsabilite/centre-responsabilite.module';
import { CompteModule } from '../../referentiels/compte/compte.module';
import { DeviseModule } from '../../referentiels/devise/devise.module';
import { LigneMetierModule } from '../../referentiels/ligne-metier/ligne-metier.module';
import { ProduitModule } from '../../referentiels/produit/produit.module';
import { ScenarioModule } from '../../referentiels/scenario/scenario.module';
import { SegmentModule } from '../../referentiels/segment/segment.module';
import { StructureModule } from '../../referentiels/structure/structure.module';
import { TauxChangeModule } from '../../referentiels/taux-change/taux-change.module';
import { TempsModule } from '../../referentiels/temps/temps.module';
import { DimVersion } from '../../referentiels/version/entities/dim-version.entity';
import { VersionModule } from '../../referentiels/version/version.module';
import { FaitBudget } from './entities/fait-budget.entity';
import { FaitBudgetController } from './fait-budget.controller';
import { FaitBudgetService } from './fait-budget.service';

/**
 * FaitBudgetModule importe directement l'entité `DimVersion` pour
 * le garde-fou de statut (assertVersionOuverte) et les 11 modules
 * référentiels pour la résolution dynamique 3.2B
 * (`createFromBusinessKeys`).
 *
 * Pas de `forwardRef` (FaitBudgetModule importe les autres, jamais
 * l'inverse).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([FaitBudget, DimVersion]),
    AuthModule,
    TempsModule,
    StructureModule,
    CentreResponsabiliteModule,
    CompteModule,
    LigneMetierModule,
    ProduitModule,
    SegmentModule,
    DeviseModule,
    VersionModule,
    ScenarioModule,
    TauxChangeModule,
  ],
  controllers: [FaitBudgetController],
  providers: [FaitBudgetService],
  exports: [FaitBudgetService],
})
export class FaitBudgetModule {}
