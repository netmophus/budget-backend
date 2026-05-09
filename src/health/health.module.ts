import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';

import { NotificationsModule } from '../notifications/notifications.module';
import { HealthController } from './health.controller';

@Module({
  // NotificationsModule exporte EmailQueueProducer (Lot 6.3) qui donne
  // accès à la connexion Redis pour le ping santé.
  imports: [TerminusModule, NotificationsModule],
  controllers: [HealthController],
})
export class HealthModule {}
