/**
 * Lot 8.7.A — tests TempsController PATCH/POST etendre.
 * Délégation au service + garde de permission REFERENTIEL.GERER.
 */
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';

import { AuthUser } from '../../auth/decorators/current-user.decorator';
import { PERMISSIONS_KEY } from '../../auth/decorators/require-permissions.decorator';
import { TempsController } from './temps.controller';
import { TempsService } from './temps.service';

const USER: AuthUser = { userId: '1', email: 'admin@miznas.local' };

describe('TempsController — édition (Lot 8.7.A)', () => {
  let controller: TempsController;
  let tempsService: jest.Mocked<TempsService>;

  beforeEach(async () => {
    tempsService = {
      findAll: jest.fn(),
      findOne: jest.fn(),
      findByDate: jest.fn(),
      updateJour: jest.fn(),
      etendreCalendrier: jest.fn(),
    } as unknown as jest.Mocked<TempsService>;

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [TempsController],
      providers: [{ provide: TempsService, useValue: tempsService }],
    }).compile();

    controller = moduleRef.get(TempsController);
  });

  it('updateJour délègue au service avec id + dto + user', async () => {
    const day = { id: '5', date: '2027-06-16', jourOuvre: false } as never;
    tempsService.updateJour.mockResolvedValue(day);

    const dto = { jourOuvre: false, libelleJour: 'Tabaski 2027' };
    const result = await controller.updateJour('5', dto, USER);

    expect(result).toBe(day);
    expect(tempsService.updateJour).toHaveBeenCalledWith('5', dto, USER);
  });

  it('etendreCalendrier délègue au service avec dto + user', async () => {
    const out = {
      nbJoursAjoutes: 730,
      message: '730 jours ajoutés au calendrier',
    };
    tempsService.etendreCalendrier.mockResolvedValue(out);

    const dto = { anneeDebut: 2031, anneeFin: 2032 };
    const result = await controller.etendreCalendrier(dto, USER);

    expect(result).toBe(out);
    expect(tempsService.etendreCalendrier).toHaveBeenCalledWith(dto, USER);
  });

  it('exige REFERENTIEL.GERER sur PATCH et POST /etendre', () => {
    const reflector = new Reflector();
    const patchMeta = reflector.get(PERMISSIONS_KEY, controller.updateJour);
    const postMeta = reflector.get(
      PERMISSIONS_KEY,
      controller.etendreCalendrier,
    );

    expect(patchMeta).toEqual({
      permissions: ['REFERENTIEL.GERER'],
      mode: 'any',
    });
    expect(postMeta).toEqual({
      permissions: ['REFERENTIEL.GERER'],
      mode: 'any',
    });
  });
});
