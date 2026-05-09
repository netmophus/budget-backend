import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { Permission } from '../roles/entities/permission.entity';
import { Role } from '../roles/entities/role.entity';
import { RolePermission } from '../roles/entities/role-permission.entity';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/entities/user-role.entity';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { RefreshToken } from './entities/refresh-token.entity';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { LoginRateLimitGuard } from './guards/login-rate-limit.guard';
import { PasswordExpiredGuard } from './guards/password-expired.guard';
import { PermissionsGuard } from './guards/permissions.guard';
import { LoginRateLimiterService } from './login-rate-limiter.service';
import { MePasswordController } from './me-password.controller';
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
    ]),
    AuditModule,
  ],
  controllers: [AuthController, MePasswordController],
  providers: [
    AuthService,
    JwtStrategy,
    JwtAuthGuard,
    PermissionsService,
    PermissionsGuard,
    PasswordExpiredGuard,
    LoginRateLimiterService,
    LoginRateLimitGuard,
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
