import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LoggerModule } from 'nestjs-pino';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuditModule } from './audit/audit.module';
import { AuditInterceptor } from './audit/interceptors/audit.interceptor';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { PermissionsGuard } from './auth/guards/permissions.guard';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { HealthModule } from './health/health.module';
import { CentreResponsabiliteModule } from './referentiels/centre-responsabilite/centre-responsabilite.module';
import { DeviseModule } from './referentiels/devise/devise.module';
import { StructureModule } from './referentiels/structure/structure.module';
import { TempsModule } from './referentiels/temps/temps.module';
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
    HealthModule,
    UsersModule,
    RolesModule,
    AuditModule,
    AuthModule,
    TempsModule,
    DeviseModule,
    StructureModule,
    CentreResponsabiliteModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Ordre important : authentification d'abord (req.user posé), puis
    // autorisation par permissions sur la base de req.user.userId.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    // Audit : intercepteur global, ne s'active que sur les endpoints @Auditable.
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
    // Filtre global d'exceptions (utilise PinoLogger).
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
