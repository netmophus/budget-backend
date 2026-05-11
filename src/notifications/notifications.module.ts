import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { User } from '../users/entities/user.entity';
import { EmailQueueModule } from './email-queue.module';
import { EmailWorker } from './email.worker';
import { EmailLog } from './entities/email-log.entity';
import { NotificationsController } from './notifications.controller';
import { NotificationsListeners } from './notifications.listeners';
import { NotificationsService } from './notifications.service';

/**
 * NotificationsModule (Lot 4.3 + Lot 6.3 — async via BullMQ).
 * Point d'entrée unique pour la traçabilité et l'envoi des emails.
 * Indépendant des modules métier qui émettent leurs événements via
 * EventEmitter (le bus est enregistré globalement dans app.module.ts).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([EmailLog, User]),
    ConfigModule,
    AuthModule,
    // Lot 6.4.C — EmailQueueModule expose le Producer (et la queue
    // BullMQ). Le Worker (@Processor) reste registré ici, pas dans
    // EmailQueueModule, pour ne pas être propagé transitivement aux
    // modules qui ont juste besoin de PUBLIER des jobs (UsersModule).
    EmailQueueModule,
  ],
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationsListeners, EmailWorker],
  exports: [NotificationsService, EmailQueueModule],
})
export class NotificationsModule {}
