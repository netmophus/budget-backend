import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { UserPerimetresController } from './controllers/user-perimetres.controller';
import { User } from './entities/user.entity';
import { UserPerimetre } from './entities/user-perimetre.entity';
import { UserRole } from './entities/user-role.entity';
import { UserPerimetreService } from './services/user-perimetre.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, UserRole, UserPerimetre]),
    AuthModule,
    AuditModule,
  ],
  controllers: [UsersController, UserPerimetresController],
  providers: [UsersService, UserPerimetreService],
  exports: [TypeOrmModule, UsersService, UserPerimetreService],
})
export class UsersModule {}
