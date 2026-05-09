/**
 * Tests unitaires EmailWorker (Lot 6.3.B).
 *
 * Le worker délègue tout à NotificationsService — on vérifie ici la
 * logique de retry/dead-letter :
 *  - 1ère tentative succès → traiterJob OK, pas de marquerEchecDefinitif
 *  - tentative intermédiaire échec → throw + pas de marquerEchecDefinitif
 *  - dernière tentative échec → throw + marquerEchecDefinitif appelé
 *  - job sans attempts défini (défaut 1) → 1 essai, échec = définitif
 *  - log d'avertissement (warn) quand une tentative échoue
 *  - attemptsMade transmis correctement au service
 *
 * Le @Processor decorator + WorkerHost de @nestjs/bullmq sont
 * inactifs en test unitaire (pas de connexion Redis car on ne
 * passe pas par BullModule). On instancie directement la classe et
 * on appelle process() avec un Job mocké.
 */
import { Job } from 'bullmq';

import { EmailWorker } from './email.worker';
import type { EmailJobData } from './email-queue.producer';
import type { NotificationsService } from './notifications.service';

interface NotificationsServiceMock {
  traiterJob: jest.Mock;
  marquerEchecDefinitif: jest.Mock;
}

function makeServiceMock(): NotificationsServiceMock {
  return {
    traiterJob: jest.fn().mockResolvedValue(undefined),
    marquerEchecDefinitif: jest.fn().mockResolvedValue(undefined),
  };
}

function makeJob(
  emailLogId: string,
  attemptsMade: number,
  attempts?: number,
): Job<EmailJobData> {
  // Si attempts est omis, opts ne contient PAS la clé attempts (ce
  // qui simule le défaut BullMQ : 1 tentative).
  const opts: { attempts?: number } =
    attempts !== undefined ? { attempts } : {};
  return {
    id: 'job-1',
    data: { emailLogId },
    attemptsMade,
    opts,
  } as unknown as Job<EmailJobData>;
}

function makeWorker(svc: NotificationsServiceMock): EmailWorker {
  return new EmailWorker(svc as unknown as NotificationsService);
}

describe('EmailWorker', () => {
  it('1ère tentative succès → traiterJob appelé, marquerEchecDefinitif PAS appelé', async () => {
    const svc = makeServiceMock();
    const worker = makeWorker(svc);

    await worker.process(makeJob('42', 0));

    // Lot 6.4.C — le worker propage `secrets` (3e arg) même quand
    // undefined dans job.data, pour signature uniforme.
    expect(svc.traiterJob).toHaveBeenCalledWith('42', 0, undefined);
    expect(svc.marquerEchecDefinitif).not.toHaveBeenCalled();
  });

  it('tentative intermédiaire échec → re-throw + PAS de bascule ECHEC définitif', async () => {
    const svc = makeServiceMock();
    svc.traiterJob.mockRejectedValueOnce(new Error('SMTP transient'));
    const worker = makeWorker(svc);

    // attemptsMade=0, attempts=3 → ce n'est PAS la dernière (0+1 < 3).
    await expect(worker.process(makeJob('42', 0, 3))).rejects.toThrow(
      'SMTP transient',
    );

    expect(svc.traiterJob).toHaveBeenCalledTimes(1);
    expect(svc.marquerEchecDefinitif).not.toHaveBeenCalled();
  });

  it('dernière tentative échec (attemptsMade+1 === attempts) → marquerEchecDefinitif appelé', async () => {
    const svc = makeServiceMock();
    svc.traiterJob.mockRejectedValueOnce(new Error('SMTP DOWN'));
    const worker = makeWorker(svc);

    // attemptsMade=2, attempts=3 → c'est la dernière (2+1 === 3).
    await expect(worker.process(makeJob('42', 2, 3))).rejects.toThrow(
      'SMTP DOWN',
    );

    expect(svc.traiterJob).toHaveBeenCalledWith('42', 2, undefined);
    expect(svc.marquerEchecDefinitif).toHaveBeenCalledWith('42', 'SMTP DOWN');
  });

  it('job sans options.attempts (default 1) → 1 essai, échec = définitif', async () => {
    const svc = makeServiceMock();
    svc.traiterJob.mockRejectedValueOnce(new Error('Boom'));
    const worker = makeWorker(svc);

    // attempts omis → considéré comme 1 (cf. ?? 1 dans le worker).
    // Dès la première erreur (attemptsMade=0, max=1 → 0+1 >= 1) c'est
    // déjà la dernière.
    await expect(worker.process(makeJob('42', 0))).rejects.toThrow('Boom');

    expect(svc.marquerEchecDefinitif).toHaveBeenCalledWith('42', 'Boom');
  });

  it('attemptsMade transmis tel quel à traiterJob (cohérence compteur tentatives)', async () => {
    const svc = makeServiceMock();
    const worker = makeWorker(svc);

    await worker.process(makeJob('77', 5, 10));

    expect(svc.traiterJob).toHaveBeenCalledWith('77', 5, undefined);
  });

  it("erreur non-Error (ex: string) → message stringifié + bascule ECHEC en dernière tentative", async () => {
    const svc = makeServiceMock();
    // Reject avec une valeur non-Error (cas pathologique mais possible).
    svc.traiterJob.mockRejectedValueOnce('plain string error');
    const worker = makeWorker(svc);

    await expect(worker.process(makeJob('42', 2, 3))).rejects.toBe(
      'plain string error',
    );

    expect(svc.marquerEchecDefinitif).toHaveBeenCalledWith(
      '42',
      'plain string error',
    );
  });
});
