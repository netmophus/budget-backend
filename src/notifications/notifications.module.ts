import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { User } from '../users/entities/user.entity';
import { EMAIL_QUEUE_NAME, EmailQueueProducer } from './email-queue.producer';
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
    BullModule.registerQueue({ name: EMAIL_QUEUE_NAME }),
  ],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationsListeners,
    EmailQueueProducer,
    EmailWorker,
  ],
  exports: [NotificationsService, EmailQueueProducer],
})
export class NotificationsModule {}
