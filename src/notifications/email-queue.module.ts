/**
 * EmailQueueModule (Lot 6.4.C) — wrapper qui expose UNIQUEMENT le
 * Producer + la déclaration de queue, sans le Worker (`@Processor`).
 *
 * Pourquoi ce module séparé : importer NotificationsModule depuis un
 * autre module (ex: UsersModule pour le reset password admin)
 * propage le `EmailWorker` via le `BullExplorer` de @nestjs/bullmq.
 * Au boot, BullExplorer essaie de créer un BullMQ Worker qui exige
 * une connexion Redis active — donc le simple boot d'AppModule en
 * test in-process (pg-mem, sans Redis) crashe avec "Worker requires
 * a connection".
 *
 * EmailQueueModule isole le strict minimum (registerQueue +
 * EmailQueueProducer) pour qu'un module puisse PUBLIER des jobs
 * sans tirer le Worker dans son scope. Le Worker reste registré une
 * seule fois dans NotificationsModule (qui importe ce module).
 */
import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { EMAIL_QUEUE_NAME, EmailQueueProducer } from './email-queue.producer';

@Module({
  imports: [BullModule.registerQueue({ name: EMAIL_QUEUE_NAME })],
  providers: [EmailQueueProducer],
  exports: [EmailQueueProducer, BullModule],
})
export class EmailQueueModule {}
