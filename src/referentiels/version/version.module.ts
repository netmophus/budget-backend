import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditModule } from '../../audit/audit.module';
import { AuthModule } from '../../auth/auth.module';
import { DimScenario } from '../scenario/entities/dim-scenario.entity';
import { ScenarioModule } from '../scenario/scenario.module';
import { DimVersion } from './entities/dim-version.entity';
import { VersionController } from './version.controller';
import { VersionService } from './version.service';
import { VersionWorkflowService } from './version-workflow.service';

@Module({
  imports: [
    // DimScenario chargé pour permettre `manager.getRepository(DimScenario)`
    // dans la transaction du hook Q9 (Lot 3.2).
    // Note (Lot 3.5) : FaitBudget n'est volontairement PAS importé ici
    // pour éviter un couplage entité (et la cascade de relations vers
    // les autres dim). Le service workflow compte les lignes via
    // raw query SQL `SELECT COUNT(*) FROM fait_budget WHERE fk_version`.
    TypeOrmModule.forFeature([DimVersion, DimScenario]),
    AuthModule,
    // Lot 3.2 — hook Q9 : auto-création scénario MEDIAN + audit
    ScenarioModule,
    AuditModule,
  ],
  controllers: [VersionController],
  providers: [VersionService, VersionWorkflowService],
  exports: [VersionService, VersionWorkflowService],
})
export class VersionModule {}
