/**
 * E2E.7 — Flux complet emails async (Lot 6.3.B).
 *
 * Couvre le parcours queue + worker dans Postgres + Redis réels via
 * testcontainers (cf. setup-global.ts) :
 *
 *  - SENT : insertion email_log statut=EN_ATTENTE → publication queue →
 *    worker prend le job → SMTP mocké réussi → statut=ENVOYE.
 *  - FAILED : insertion email_log → publication queue avec attempts=1
 *    (forcer une tentative unique) → SMTP mocké rejette → statut=ECHEC
 *    après bascule par marquerEchecDefinitif.
 *
 * `nodemailer.createTransport` est mocké au niveau du module — le mock
 * est hoisted au sommet du file par Jest, donc tous les imports
 * indirects de nodemailer dans le AppModule pointent sur ce mock.
 *
 * EMAIL_DRY_RUN doit être 'false' pour que le service publie réellement
 * (sinon il fait un INSERT statut=SUPPRIME et ne touche pas la queue).
 */
import { type INestApplication } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { getRepositoryToken } from '@nestjs/typeorm';
import { type Queue } from 'bullmq';
import type { Repository } from 'typeorm';

import { bootstrapApp } from './helpers/app';
import { EmailLog } from '../../src/notifications/entities/email-log.entity';
import {
  EMAIL_JOB_NAME,
  EMAIL_QUEUE_NAME,
} from '../../src/notifications/email-queue.producer';

// ─── Mock nodemailer global pour ce file ─────────────────────────────
// Jest hoisted ce mock avant les imports nodemailer du AppModule.
const sendMailMock = jest.fn();
jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({
    sendMail: (...args: unknown[]) => sendMailMock(...args),
  })),
}));

async function waitForStatut(
  repo: Repository<EmailLog>,
  emailLogId: string,
  attendus: ReadonlyArray<'ENVOYE' | 'ECHEC'>,
  timeoutMs = 25_000,
): Promise<EmailLog> {
  const start = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const row = await repo.findOne({ where: { id: emailLogId } });
    if (row && (attendus as readonly string[]).includes(row.statut)) return row;
    if (Date.now() - start >= timeoutMs) {
      throw new Error(
        `email_log ${emailLogId} n'a pas atteint statut ∈ {${attendus.join(',')}} en ${timeoutMs}ms (statut courant : ${row?.statut ?? 'null'})`,
      );
    }
    await new Promise((r) => setTimeout(r, 150));
  }
}

describe('E2E.7 — Flux complet emails async (queue + worker)', () => {
  let app: INestApplication;
  let emailLogRepo: Repository<EmailLog>;
  let queue: Queue;

  beforeAll(async () => {
    // Force EMAIL_DRY_RUN=false pour que le service publie dans la
    // queue. Restoré en afterAll pour ne pas affecter d'autres specs
    // si l'ordre Jest changeait.
    process.env.EMAIL_DRY_RUN = 'false';
    app = await bootstrapApp();
    emailLogRepo = app.get<Repository<EmailLog>>(getRepositoryToken(EmailLog));
    queue = app.get<Queue>(getQueueToken(EMAIL_QUEUE_NAME));
  });

  afterAll(async () => {
    await app.close();
    process.env.EMAIL_DRY_RUN = 'true';
  });

  beforeEach(() => {
    sendMailMock.mockReset();
  });

  it('SENT : worker traite le job et passe email_log de EN_ATTENTE à ENVOYE', async () => {
    sendMailMock.mockResolvedValue({ messageId: 'mock-success' });

    // Insertion email_log statut EN_ATTENTE (simule l'étape faite par
    // NotificationsService.envoyer après création).
    const log = await emailLogRepo.save(
      emailLogRepo.create({
        evenement: 'BUDGET_SOUMIS',
        fkDestinataire: null,
        destinataireEmail: 'e2e-sent@miznas.local',
        sujet: '[E2E] Test envoi OK',
        template: 'budget-soumis',
        payload: { codeVersion: 'V_E2E_SENT' },
        statut: 'EN_ATTENTE',
        tentatives: 0,
      }),
    );

    await queue.add(
      EMAIL_JOB_NAME,
      { emailLogId: log.id },
      { attempts: 3, removeOnComplete: 100, removeOnFail: 100 },
    );

    const final = await waitForStatut(emailLogRepo, log.id, ['ENVOYE']);
    expect(final.statut).toBe('ENVOYE');
    expect(final.envoyeLe).not.toBeNull();
    expect(final.tentatives).toBeGreaterThanOrEqual(1);
    expect(sendMailMock).toHaveBeenCalled();
  });

  it('FAILED : SMTP rejette, après attempts épuisés email_log passe en ECHEC', async () => {
    sendMailMock.mockRejectedValue(new Error('SMTP DOWN test'));

    const log = await emailLogRepo.save(
      emailLogRepo.create({
        evenement: 'BUDGET_SOUMIS',
        fkDestinataire: null,
        destinataireEmail: 'e2e-failed@miznas.local',
        sujet: '[E2E] Test échec SMTP',
        template: 'budget-soumis',
        payload: { codeVersion: 'V_E2E_FAILED' },
        statut: 'EN_ATTENTE',
        tentatives: 0,
      }),
    );

    // attempts=1 pour ne pas attendre le backoff exponential (2s+4s+8s)
    // entre 3 retries — la logique de bascule ECHEC est la même
    // (worker détecte attemptsMade+1 >= attempts et appelle
    // marquerEchecDefinitif).
    await queue.add(
      EMAIL_JOB_NAME,
      { emailLogId: log.id },
      { attempts: 1, removeOnComplete: 100, removeOnFail: 100 },
    );

    const final = await waitForStatut(emailLogRepo, log.id, ['ECHEC']);
    expect(final.statut).toBe('ECHEC');
    expect(final.dernierMessageErreur).toMatch(/SMTP DOWN test/);
    expect(sendMailMock).toHaveBeenCalled();
  });
});
