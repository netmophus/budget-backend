/**
 * EmailWorker (Lot 6.3.A — STUB ; implémentation complète au 6.3.B).
 *
 * Consume la queue `emails` et tente l'envoi SMTP via NotificationsService.
 * Pour ce palier 6.3.A, le stub se contente de logger la prise en main
 * du job et de basculer la ligne en `EN_COURS`. Le palier 6.3.B
 * complétera : envoi SMTP, transition ENVOYE/ECHEC, retries.
 */
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';

import { EMAIL_QUEUE_NAME, type EmailJobData } from './email-queue.producer';

@Processor(EMAIL_QUEUE_NAME)
export class EmailWorker extends WorkerHost {
  private readonly logger = new Logger(EmailWorker.name);

  // eslint-disable-next-line @typescript-eslint/require-await
  async process(job: Job<EmailJobData>): Promise<void> {
    this.logger.log(
      `[stub 6.3.A] job ${job.id} reçu pour email_log ${job.data.emailLogId} — implémentation complète au 6.3.B`,
    );
    // TODO 6.3.B : reload email_log, transition EN_COURS, envoyer
    // SMTP via nodemailer, transition ENVOYE/ECHEC, throw si fail
    // pour déclencher la retry BullMQ.
  }
}
