import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { EmailQueueModule } from '../notifications/email-queue.module';
import { EmailLog } from '../notifications/entities/email-log.entity';
import { Permission } from '../roles/entities/permission.entity';
import { Role } from '../roles/entities/role.entity';
import { RolePermission } from '../roles/entities/role-permission.entity';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/entities/user-role.entity';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { ForgotPasswordController } from './forgot-password.controller';
import { PasswordResetToken } from './entities/password-reset-token.entity';
import { RefreshToken } from './entities/refresh-token.entity';
import { ForgotPasswordRateLimitGuard } from './guards/forgot-password-rate-limit.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { LoginRateLimitGuard } from './guards/login-rate-limit.guard';
import { PasswordExpiredGuard } from './guards/password-expired.guard';
import { PermissionsGuard } from './guards/permissions.guard';
import { LoginRateLimiterService } from './login-rate-limiter.service';
import { MePasswordController } from './me-password.controller';
import { PasswordResetCleanupCronService } from './password-reset-cleanup-cron.service';
import { PasswordResetService } from './password-reset.service';
import { PermissionsService } from './permissions.service';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const secret = config.get<string>('JWT_SECRET');
        if (!secret) {
          throw new Error('JWT_SECRET is not defined');
        }
        const expiresIn = config.get<string>('JWT_ACCESS_EXPIRES_IN') ?? '15m';
        return {
          secret,
          signOptions: {
            // jsonwebtoken accepts strings like "15m", "7d" — cast through the
            // narrower StringValue type required by @nestjs/jwt typings.
            expiresIn: expiresIn as unknown as number,
          },
        };
      },
    }),
    TypeOrmModule.forFeature([
      RefreshToken,
      User,
      UserRole,
      Role,
      Permission,
      RolePermission,
      // Lot 6.5.A — forgot password self-service.
      PasswordResetToken,
      EmailLog,
    ]),
    AuditModule,
    // Lot 6.5.A — publication de jobs email (forgot password).
    EmailQueueModule,
    // Lot 6.5.A — cron quotidien nettoyage tokens. ScheduleModule
    // est `@Global()` ; cet import est défensif au cas où l'ordre
    // de chargement des modules ne garantirait pas que
    // DelegationsModule l'a déjà initialisé.
    ScheduleModule.forRoot(),
  ],
  controllers: [AuthController, MePasswordController, ForgotPasswordController],
  providers: [
    AuthService,
    JwtStrategy,
    JwtAuthGuard,
    PermissionsService,
    PermissionsGuard,
    PasswordExpiredGuard,
    LoginRateLimiterService,
    LoginRateLimitGuard,
    // Lot 6.5.A — forgot password self-service.
    PasswordResetService,
    ForgotPasswordRateLimitGuard,
    PasswordResetCleanupCronService,
  ],
  exports: [
    AuthService,
    JwtAuthGuard,
    PermissionsService,
    PermissionsGuard,
    PasswordExpiredGuard,
  ],
})
export class AuthModule {}
