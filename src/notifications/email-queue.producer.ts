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
  /**
   * Lot 6.4.C — secrets transitoires (ex: mot de passe temporaire
   * d'un reset admin). Stockés UNIQUEMENT dans le job BullMQ (Redis,
   * éphémère le temps du traitement) — JAMAIS dans `email_log.payload`
   * ni dans `audit_log`. Disponibles au worker au moment du rendu
   * Handlebars ; détruits avec le job (removeOnComplete=100,
   * removeOnFail=1000).
   */
  secrets?: Record<string, string>;
}

export interface QueueStats {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}

export const EMAIL_QUEUE_NAME = 'emails';
export const EMAIL_JOB_NAME = 'envoi';

@Injectable()
export class EmailQueueProducer {
  constructor(
    @InjectQueue(EMAIL_QUEUE_NAME) private readonly queue: Queue<EmailJobData>,
  ) {}

  async publier(
    emailLogId: string,
    secrets?: Record<string, string>,
  ): Promise<void> {
    const data: EmailJobData = { emailLogId };
    if (secrets && Object.keys(secrets).length > 0) {
      data.secrets = secrets;
    }
    await this.queue.add(EMAIL_JOB_NAME, data, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2_000 },
      removeOnComplete: 100,
      removeOnFail: 1_000,
    });
  }

  /**
   * Ping Redis via la connexion ioredis sous-jacente à la queue.
   * Utilisé par le healthcheck — ne throw jamais (retourne false en
   * cas d'erreur) pour permettre un statut 'degraded' plutôt que
   * 'down hard' au niveau de l'app.
   */
  async pingRedis(): Promise<boolean> {
    try {
      const client = await this.queue.client;
      const pong = await client.ping();
      return pong === 'PONG';
    } catch {
      return false;
    }
  }

  /**
   * Compteurs BullMQ par état (waiting / active / completed / failed
   * / delayed). Utilisé par l'endpoint admin queue stats.
   */
  async getQueueStats(): Promise<QueueStats> {
    const counts = await this.queue.getJobCounts(
      'waiting',
      'active',
      'completed',
      'failed',
      'delayed',
    );
    return {
      waiting: counts.waiting ?? 0,
      active: counts.active ?? 0,
      completed: counts.completed ?? 0,
      failed: counts.failed ?? 0,
      delayed: counts.delayed ?? 0,
    };
  }
}
