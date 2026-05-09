/**
 * EmailQueueProducer (Lot 6.3.A) — point de publication unique des
 * jobs d'envoi email vers la queue BullMQ `emails`.
 *
 * Le service NotificationsService crée d'abord la ligne `email_log`
 * (statut EN_ATTENTE) puis publie ici un job qui ne contient que
 * `emailLogId` — le worker rechargera tout depuis la DB pour rester
 * indépendant du payload réseau.
 *
 * Options de retry par défaut :
 *  - attempts: 3 (1 tentative initiale + 2 retries)
 *  - backoff exponentiel : 2s → 4s → 8s
 *  - removeOnComplete: 100 (garde les 100 derniers réussis pour debug)
 *  - removeOnFail: 1000 (garde les 1000 derniers échecs pour analyse)
 */
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';

export interface EmailJobData {
  emailLogId: string;
}

export const EMAIL_QUEUE_NAME = 'emails';
export const EMAIL_JOB_NAME = 'envoi';

@Injectable()
export class EmailQueueProducer {
  constructor(
    @InjectQueue(EMAIL_QUEUE_NAME) private readonly queue: Queue<EmailJobData>,
  ) {}

  async publier(emailLogId: string): Promise<void> {
    await this.queue.add(
      EMAIL_JOB_NAME,
      { emailLogId },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2_000 },
        removeOnComplete: 100,
        removeOnFail: 1_000,
      },
    );
  }
}
