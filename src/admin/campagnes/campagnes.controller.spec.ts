/**
 * Tests unitaires CampagnesController (Lot 6.6 — E14).
 *
 * Couvre :
 *  - 200 OK avec version existante en statut 'ouvert' → émission de
 *    EVENT_CAMPAGNE_OUVERTE avec le bon payload (auteur, dates,
 *    commentaire).
 *  - 200 OK sans body (dates par défaut : NOW + NOW+90j).
 *  - 404 si version introuvable.
 *  - 400 si statut !== 'ouvert'.
 *  - Idempotence : 2 appels successifs émettent 2 événements.
 *
 * La protection RBAC (BUDGET.PUBLIER) n'est PAS testée ici — c'est
 * le PermissionsGuard global qui s'en charge, couvert par ses propres
 * tests. Ce spec valide uniquement la logique du handler.
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';

import type { AuthUser } from '../../auth/decorators/current-user.decorator';
import {
  type CampagneOuverteEventPayload,
  EVENT_CAMPAGNE_OUVERTE,
} from '../../notifications/notifications.events';
import { DimVersion } from '../../referentiels/version/entities/dim-version.entity';
import { CampagnesController } from './campagnes.controller';

describe('CampagnesController (Lot 6.6 — E14)', () => {
  let controller: CampagnesController;
  let versionRepo: jest.Mocked<Repository<DimVersion>>;
  let eventEmitter: jest.Mocked<EventEmitter2>;
  const auteur: AuthUser = {
    userId: '7',
    email: 'admin@miznas.local',
  };

  function makeVersion(over: Partial<DimVersion> = {}): DimVersion {
    return {
      id: '42',
      codeVersion: 'BUDGET_INITIAL_2027',
      libelle: 'Budget initial 2027',
      typeVersion: 'budget_initial',
      exerciceFiscal: 2027,
      statut: 'ouvert',
      ...over,
    } as DimVersion;
  }

  beforeEach(async () => {
    versionRepo = {
      findOne: jest.fn(),
    } as unknown as jest.Mocked<Repository<DimVersion>>;
    eventEmitter = {
      emit: jest.fn().mockReturnValue(true),
    } as unknown as jest.Mocked<EventEmitter2>;

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [CampagnesController],
      providers: [
        { provide: getRepositoryToken(DimVersion), useValue: versionRepo },
        { provide: EventEmitter2, useValue: eventEmitter },
      ],
    }).compile();
    controller = moduleRef.get(CampagnesController);
  });

  it('200 OK + émet EVENT_CAMPAGNE_OUVERTE avec dates du body', async () => {
    versionRepo.findOne.mockResolvedValue(makeVersion());
    const r = await controller.ouvrir(
      '42',
      {
        dateOuverture: '2026-08-01',
        dateFermeture: '2026-10-31',
        commentaire: 'Lettre DG 07/07/2026',
      },
      auteur,
    );
    expect(r.versionId).toBe('42');
    expect(r.codeVersion).toBe('BUDGET_INITIAL_2027');
    expect(r.dateOuverture).toBe(new Date('2026-08-01').toISOString());
    expect(r.dateFermeture).toBe(new Date('2026-10-31').toISOString());

    expect(eventEmitter.emit).toHaveBeenCalledTimes(1);
    const [eventName, payload] = eventEmitter.emit.mock.calls[0] as [
      string,
      CampagneOuverteEventPayload,
    ];
    expect(eventName).toBe(EVENT_CAMPAGNE_OUVERTE);
    expect(payload.versionId).toBe('42');
    expect(payload.codeVersion).toBe('BUDGET_INITIAL_2027');
    expect(payload.auteurId).toBe('7');
    expect(payload.auteurEmail).toBe('admin@miznas.local');
    expect(payload.commentaire).toBe('Lettre DG 07/07/2026');
    expect(payload.dateOuverture).toBe(new Date('2026-08-01').toISOString());
    expect(payload.dateFermeture).toBe(new Date('2026-10-31').toISOString());
  });

  it('200 OK + dates par défaut (NOW et NOW+90j) si body vide', async () => {
    versionRepo.findOne.mockResolvedValue(makeVersion());
    const before = Date.now();
    const r = await controller.ouvrir('42', {}, auteur);
    const after = Date.now();

    const dOuverture = new Date(r.dateOuverture).getTime();
    const dFermeture = new Date(r.dateFermeture).getTime();
    expect(dOuverture).toBeGreaterThanOrEqual(before);
    expect(dOuverture).toBeLessThanOrEqual(after);
    const ecart = dFermeture - dOuverture;
    expect(ecart).toBe(90 * 24 * 60 * 60 * 1000);

    const payload = eventEmitter.emit.mock
      .calls[0]![1] as CampagneOuverteEventPayload;
    expect(payload.commentaire).toBeNull();
  });

  it('404 si version introuvable', async () => {
    versionRepo.findOne.mockResolvedValue(null);
    await expect(controller.ouvrir('999', {}, auteur)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(eventEmitter.emit).not.toHaveBeenCalled();
  });

  it("400 si statut !== 'ouvert' (ex: 'gele')", async () => {
    versionRepo.findOne.mockResolvedValue(makeVersion({ statut: 'gele' }));
    await expect(controller.ouvrir('42', {}, auteur)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(eventEmitter.emit).not.toHaveBeenCalled();
  });

  it("400 si statut === 'soumis'", async () => {
    versionRepo.findOne.mockResolvedValue(makeVersion({ statut: 'soumis' }));
    await expect(controller.ouvrir('42', {}, auteur)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('idempotence : 2 appels successifs émettent 2 événements', async () => {
    versionRepo.findOne.mockResolvedValue(makeVersion());
    await controller.ouvrir('42', {}, auteur);
    await controller.ouvrir('42', {}, auteur);
    expect(eventEmitter.emit).toHaveBeenCalledTimes(2);
  });
});
