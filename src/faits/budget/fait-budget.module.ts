import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../../auth/auth.module';
import { DimVersion } from '../../referentiels/version/entities/dim-version.entity';
import { FaitBudget } from './entities/fait-budget.entity';
import { FaitBudgetController } from './fait-budget.controller';
import { FaitBudgetService } from './fait-budget.service';

/**
 * FaitBudgetModule importe directement l'entité `DimVersion` pour
 * vérifier le statut de la version cible avant create/update/delete
 * (garde-fou intégrité). Les autres dimensions sont chargées via les
 * relations TypeORM `@ManyToOne` de l'entité — pas besoin d'importer
 * leurs modules.
 *
 * Pas de `forwardRef` (FaitBudgetModule importe les autres, jamais
 * l'inverse).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([FaitBudget, DimVersion]),
    AuthModule,
  ],
  controllers: [FaitBudgetController],
  providers: [FaitBudgetService],
  exports: [FaitBudgetService],
})
export class FaitBudgetModule {}
