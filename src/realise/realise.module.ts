import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { BudgetModule } from '../budget/budget.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { TableauBordModule } from '../tableau-de-bord/tableau-bord.module';
import { FaitRealise } from './entities/fait-realise.entity';
import { RealiseController } from './realise.controller';
import { AlerteEcartCronService } from './services/alerte-ecart-cron.service';
import { AlerteEcartService } from './services/alerte-ecart.service';
import { RealiseImportService } from './services/realise-import.service';
import { RealiseService } from './services/realise.service';
import { RealiseTemplateService } from './services/realise-template.service';

/**
 * RealiseModule (Lot 5.1) — module métier "réalisé budgétaire".
 *
 * Réutilise PerimetreService de BudgetModule pour le filtrage RBAC
 * (CR autorisés via user_perimetres) en écriture.
 *
 * Lot 8.5.E — héberge en plus le cron mensuel d'alertes écarts
 * (AlerteEcartCronService + AlerteEcartService). Importe
 * TableauBordModule pour AnalyseEcartsService et NotificationsModule
 * pour NotificationsService.envoyer(). ScheduleModule.forRoot() est
 * idempotent (déjà importé par auth + delegations) mais doit être
 * présent dans ce module pour que @Cron y soit reconnu.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([FaitRealise]),
    ScheduleModule.forRoot(),
    AuditModule,
    AuthModule,
    BudgetModule, // pour PerimetreService
    TableauBordModule, // pour AnalyseEcartsService (Lot 8.5.E)
    NotificationsModule, // pour NotificationsService (Lot 8.5.E)
  ],
  controllers: [RealiseController],
  providers: [
    RealiseService,
    RealiseImportService,
    RealiseTemplateService,
    AlerteEcartService,
    AlerteEcartCronService,
  ],
  exports: [RealiseService, AlerteEcartService],
})
export class RealiseModule {}
