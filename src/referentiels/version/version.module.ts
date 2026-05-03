import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditModule } from '../../audit/audit.module';
import { AuthModule } from '../../auth/auth.module';
import { DimScenario } from '../scenario/entities/dim-scenario.entity';
import { ScenarioModule } from '../scenario/scenario.module';
import { DimVersion } from './entities/dim-version.entity';
import { VersionController } from './version.controller';
import { VersionService } from './version.service';

@Module({
  imports: [
    // DimScenario chargé pour permettre `manager.getRepository(DimScenario)`
    // dans la transaction du hook Q9 (Lot 3.2).
    TypeOrmModule.forFeature([DimVersion, DimScenario]),
    AuthModule,
    // Lot 3.2 — hook Q9 : auto-création scénario MEDIAN + audit
    ScenarioModule,
    AuditModule,
  ],
  controllers: [VersionController],
  providers: [VersionService],
  exports: [VersionService],
})
export class VersionModule {}
