import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { User } from '../users/entities/user.entity';
import { EmailLog } from './entities/email-log.entity';
import { NotificationsController } from './notifications.controller';
import { NotificationsListeners } from './notifications.listeners';
import { NotificationsService } from './notifications.service';

/**
 * NotificationsModule (Lot 4.3) — point d'entrée unique pour la
 * traçabilité et l'envoi des emails. Indépendant des modules
 * métier qui émettent leurs événements via EventEmitter (le bus
 * est enregistré globalement dans app.module.ts).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([EmailLog, User]),
    ConfigModule,
    AuthModule,
  ],
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationsListeners],
  exports: [NotificationsService],
})
export class NotificationsModule {}
