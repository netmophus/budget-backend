/**
 * EmailWorker (Lot 6.3.B) — consume la queue `emails` et délègue
 * l'envoi SMTP à `NotificationsService.traiterJob()`.
 *
 * Stratégie de retry : BullMQ relance automatiquement le job avec
 * backoff exponentiel (configuré dans EmailQueueProducer : attempts=3,
 * backoff exponential 2s/4s/8s). Si le worker `throw` :
 *  - tant que `attemptsMade + 1 < attempts` → BullMQ replanifie le job
 *  - quand `attemptsMade + 1 >= attempts` → le job tombe en failed list
 *    et on bascule l'email_log en ECHEC via `marquerEchecDefinitif`.
 *
 * Worker IN-PROCESS (V1 MVP). Dette tracée : à terme, séparer le worker
 * dans un process dédié pour scale indépendant et isolation crash —
 * sujet Lot 7+ (orchestration / observabilité).
 */
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';

import { EMAIL_QUEUE_NAME, type EmailJobData } from './email-queue.producer';
import { NotificationsService } from './notifications.service';

@Processor(EMAIL_QUEUE_NAME)
export class EmailWorker extends WorkerHost {
  private readonly logger = new Logger(EmailWorker.name);

  constructor(private readonly notifications: NotificationsService) {
    super();
  }

  async process(job: Job<EmailJobData>): Promise<void> {
    const { emailLogId } = job.data;
    const attemptsMade = job.attemptsMade;
    const maxAttempts = job.opts.attempts ?? 1;
    const isLastAttempt = attemptsMade + 1 >= maxAttempts;

    try {
      await this.notifications.traiterJob(emailLogId, attemptsMade);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Tentative ${attemptsMade + 1}/${maxAttempts} échouée pour email_log ${emailLogId} : ${message}`,
      );
      if (isLastAttempt) {
        // Toutes les retries sont exhausted → on bascule définitivement
        // en ECHEC. La trace finale est dans email_log + le job reste
        // dans la failed list de BullMQ (jusqu'à removeOnFail=1000).
        await this.notifications.marquerEchecDefinitif(emailLogId, message);
      }
      throw err;
    }
  }
}
