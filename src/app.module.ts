import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LoggerModule } from 'nestjs-pino';
import { CampagnesModule } from './admin/campagnes/campagnes.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuditModule } from './audit/audit.module';
import { AuditInterceptor } from './audit/interceptors/audit.interceptor';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { PasswordExpiredGuard } from './auth/guards/password-expired.guard';
import { PermissionsGuard } from './auth/guards/permissions.guard';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { DelegationsModule } from './delegations/delegations.module';
import { AnalyseIaModule } from './analyse-ia/analyse-ia.module';
import { ConfigurationBanqueModule } from './configuration-banque/configuration-banque.module';
import { DocumentsOfficielsModule } from './documents-officiels/documents-officiels.module';
import { NotificationsModule } from './notifications/notifications.module';
import { ParametreSystemeModule } from './parametre-systeme/parametre-systeme.module';
import { RealiseModule } from './realise/realise.module';
import { ReforecastModule } from './reforecast/reforecast.module';
import { ReportingModule } from './reporting/reporting.module';
import { TableauBordModule } from './tableau-de-bord/tableau-bord.module';
import { FaitBudgetModule } from './faits/budget/fait-budget.module';
import { BudgetModule } from './budget/budget.module';
import { HealthModule } from './health/health.module';
import { CentreResponsabiliteModule } from './referentiels/centre-responsabilite/centre-responsabilite.module';
import { CompteModule } from './referentiels/compte/compte.module';
import { DeviseModule } from './referentiels/devise/devise.module';
import { LigneMetierModule } from './referentiels/ligne-metier/ligne-metier.module';
import { ProduitModule } from './referentiels/produit/produit.module';
import { ScenarioModule } from './referentiels/scenario/scenario.module';
import { SegmentModule } from './referentiels/segment/segment.module';
import { StructureModule } from './referentiels/structure/structure.module';
import { TauxChangeModule } from './referentiels/taux-change/taux-change.module';
import { TempsModule } from './referentiels/temps/temps.module';
import { VersionModule } from './referentiels/version/version.module';
import { RefCategorieSegmentModule } from './referentiels-secondaires/categorie-segment/ref-categorie-segment.module';
import { RefClasseCompteModule } from './referentiels-secondaires/classe-compte/ref-classe-compte.module';
import { RefPaysModule } from './referentiels-secondaires/pays/ref-pays.module';
import { RefSensCompteModule } from './referentiels-secondaires/sens-compte/ref-sens-compte.module';
import { RefStatutScenarioModule } from './referentiels-secondaires/statut-scenario/ref-statut-scenario.module';
import { RefStatutVersionModule } from './referentiels-secondaires/statut-version/ref-statut-version.module';
import { RefTypeActionAuditModule } from './referentiels-secondaires/type-action-audit/ref-type-action-audit.module';
import { RefTypeCrModule } from './referentiels-secondaires/type-cr/ref-type-cr.module';
import { RefTypeProduitModule } from './referentiels-secondaires/type-produit/ref-type-produit.module';
import { RefTypeScenarioModule } from './referentiels-secondaires/type-scenario/ref-type-scenario.module';
import { RefTypeStructureModule } from './referentiels-secondaires/type-structure/ref-type-structure.module';
import { RefTypeTauxModule } from './referentiels-secondaires/type-taux/ref-type-taux.module';
import { RefTypeVersionModule } from './referentiels-secondaires/type-version/ref-type-version.module';
import { RolesModule } from './roles/roles.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const isProd = config.get<string>('NODE_ENV') === 'production';
        const level = config.get<string>('LOG_LEVEL') ?? 'info';
        return {
          pinoHttp: {
            level,
            // Pretty-print en dev, JSON brut en prod (parsable observabilité).
            transport: !isProd
              ? {
                  target: 'pino-pretty',
                  options: {
                    singleLine: true,
                    colorize: true,
                    translateTime: 'SYS:HH:MM:ss',
                    ignore: 'pid,hostname,context,req,res,responseTime',
                  },
                }
              : undefined,
            // Ne pas spammer les logs HTTP avec /health (probes répétitifs).
            autoLogging: {
              ignore: (req: { url?: string }) =>
                (req.url ?? '').includes('/health'),
            },
            // Réduire le bruit en mode test.
            ...(process.env.NODE_ENV === 'test' ? { level: 'silent' } : {}),
          },
        };
      },
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get<string>('DB_HOST'),
        port: config.get<number>('DB_PORT'),
        username: config.get<string>('DB_USER'),
        password: config.get<string>('DB_PASSWORD'),
        database: config.get<string>('DB_NAME'),
        autoLoadEntities: true,
        synchronize: false,
        migrationsRun: false,
      }),
    }),
    // Lot 4.3 — bus d'événements applicatif (couplage faible). Doit
    // être enregistré globalement pour que les services métier puissent
    // injecter EventEmitter2 sans dépendre de NotificationsModule.
    EventEmitterModule.forRoot({
      wildcard: false,
      delimiter: '.',
      maxListeners: 20,
      verboseMemoryLeak: true,
    }),
    // Lot 6.3 — BullMQ + Redis pour la queue 'emails' (envoi async
    // des notifications). La connexion Redis est partagée par toutes
    // les queues qui s'enregistreront via BullModule.registerQueue().
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get<string>('REDIS_HOST', 'localhost'),
          port: Number(config.get<string>('REDIS_PORT', '6379')),
          password: config.get<string>('REDIS_PASSWORD') || undefined,
        },
      }),
    }),
    HealthModule,
    UsersModule,
    RolesModule,
    AuditModule,
    AuthModule,
    TempsModule,
    DeviseModule,
    StructureModule,
    CentreResponsabiliteModule,
    CompteModule,
    LigneMetierModule,
    ProduitModule,
    ScenarioModule,
    SegmentModule,
    TauxChangeModule,
    VersionModule,
    FaitBudgetModule,
    BudgetModule,
    // Lot 4.2 — délégations temporaires
    DelegationsModule,
    // Lot 4.3 — notifications email
    NotificationsModule,
    // Lot 5.1 — réalisé budgétaire
    RealiseModule,
    ParametreSystemeModule,
    ConfigurationBanqueModule,
    // Chantier C1 — historisation des analyses IA
    AnalyseIaModule,
    // Lot 5.2 — tableau de bord budget vs réalisé
    TableauBordModule,
    // Lot 5.3 — reforecast trimestriel
    ReforecastModule,
    // Lot 6.6 — E14 ouverture campagne budgétaire (admin)
    CampagnesModule,
    // Lot 7.6 — module reporting officiel (R01–R20, R04 en premier)
    ReportingModule,
    // Lot 8.1.A — fondation DB du workflow signature (campagnes,
    // documents officiels, visas, signatures). Service + controller
    // aux Lots 8.1.B et 8.1.C.
    DocumentsOfficielsModule,
    // Référentiels secondaires (énumérations) — Lot 2.5-bis-A.
    RefTypeStructureModule,
    RefPaysModule,
    RefTypeCrModule,
    RefSensCompteModule,
    RefClasseCompteModule,
    RefTypeProduitModule,
    RefCategorieSegmentModule,
    RefTypeVersionModule,
    RefStatutVersionModule,
    RefTypeScenarioModule,
    RefStatutScenarioModule,
    RefTypeTauxModule,
    RefTypeActionAuditModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Ordre important : authentification d'abord (req.user posé), puis
    // contrôle expiration mdp (Lot 6.4.A — bloque si mdpExpire/dcm
    // sauf whitelist), puis autorisation par permissions.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PasswordExpiredGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    // Audit : intercepteur global, ne s'active que sur les endpoints @Auditable.
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
    // Filtre global d'exceptions (utilise PinoLogger).
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
