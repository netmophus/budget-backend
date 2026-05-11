import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { EmailQueueModule } from '../notifications/email-queue.module';
import { EmailLog } from '../notifications/entities/email-log.entity';
import { Role } from '../roles/entities/role.entity';
import { UserPerimetresController } from './controllers/user-perimetres.controller';
import { UsersAdminController } from './controllers/users-admin.controller';
import { User } from './entities/user.entity';
import { UserPerimetre } from './entities/user-perimetre.entity';
import { UserRole } from './entities/user-role.entity';
import { UserPerimetreService } from './services/user-perimetre.service';
import { UsersAdminService } from './services/users-admin.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, UserRole, UserPerimetre, Role, EmailLog]),
    AuthModule,
    AuditModule,
    // Lot 6.4.C — UsersAdminService.resetPassword publie un job email
    // via EmailQueueProducer. On importe EmailQueueModule (sans le
    // Worker) plutôt que NotificationsModule entier pour ne pas
    // tirer le BullExplorer / EmailWorker dans le scope d'UsersModule
    // (cassait les tests in-process pg-mem qui n'ont pas Redis).
    EmailQueueModule,
    // Lot 4.3 — UserPerimetreService.creer émet AFFECTATION_CREEE.
    // forRoot() local rend le module autonome pour les e2e isolés ;
    // app.module.ts l'enregistre aussi en root (idempotent NestJS).
    EventEmitterModule.forRoot(),
  ],
  controllers: [
    UsersController,
    UserPerimetresController,
    UsersAdminController, // Lot Administration
  ],
  providers: [
    UsersService,
    UserPerimetreService,
    UsersAdminService, // Lot Administration
  ],
  exports: [
    TypeOrmModule,
    UsersService,
    UserPerimetreService,
    UsersAdminService,
  ],
})
export class UsersModule {}
