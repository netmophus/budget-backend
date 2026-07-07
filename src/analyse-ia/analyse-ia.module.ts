import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { AnalyseIaController } from './analyse-ia.controller';
import { AnalyseIaCronService } from './analyse-ia-cron.service';
import { AnalyseIaService } from './analyse-ia.service';
import { AnalyseIa } from './entities/analyse-ia.entity';

/**
 * AnalyseIaModule (Chantier C1) — historisation des analyses MIZNAS AI :
 * persistance + endpoints de consultation/suppression + purge cron 24 mois.
 * Exporte AnalyseIaService pour que TableauBordController persiste après
 * chaque analyse réussie (best-effort).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([AnalyseIa]),
    ScheduleModule.forRoot(), // idempotent — requis pour @Cron local
    AuthModule, // PermissionsService + guards
    AuditModule,
  ],
  controllers: [AnalyseIaController],
  providers: [AnalyseIaService, AnalyseIaCronService],
  exports: [AnalyseIaService],
})
export class AnalyseIaModule {}
