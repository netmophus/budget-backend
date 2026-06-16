import { Test, TestingModule } from '@nestjs/testing';

import { TempsController } from './temps.controller';
import { TempsService } from './temps.service';

describe('TempsController', () => {
  let controller: TempsController;
  let tempsService: jest.Mocked<TempsService>;

  beforeEach(async () => {
    tempsService = {
      findAll: jest.fn(),
      findOne: jest.fn(),
      findByDate: jest.fn(),
      findRange: jest.fn(),
      findByMois: jest.fn(),
      findExercice: jest.fn(),
    } as unknown as jest.Mocked<TempsService>;

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [TempsController],
      providers: [{ provide: TempsService, useValue: tempsService }],
    }).compile();

    controller = moduleRef.get(TempsController);
  });

  it('findAll delegates with the parsed query DTO', async () => {
    const dto = { items: [], total: 0, page: 1, limit: 366 };
    tempsService.findAll.mockResolvedValue(dto);

    const result = await controller.findAll({ page: 1, limit: 366 });
    expect(result).toBe(dto);
    expect(tempsService.findAll).toHaveBeenCalledWith({ page: 1, limit: 366 });
  });

  it('findOne delegates by id', async () => {
    const day = {
      id: '1',
      date: '2026-01-01',
      annee: 2026,
      trimestre: 1,
      mois: 1,
      jour: 1,
      semaineIso: 1,
      jourOuvre: false,
      estFinDeMois: false,
      estFinDeTrimestre: false,
      estFinDAnnee: false,
      exerciceFiscal: 2026,
      libelleMois: 'Janv. 2026',
      libelleJour: null,
    };
    tempsService.findOne.mockResolvedValue(day);

    expect(await controller.findOne('1')).toBe(day);
    expect(tempsService.findOne).toHaveBeenCalledWith('1');
  });

  it('findByDate delegates with the date param', async () => {
    const day = {
      id: '120',
      date: '2026-05-01',
      annee: 2026,
      trimestre: 2,
      mois: 5,
      jour: 1,
      semaineIso: 18,
      jourOuvre: false,
      estFinDeMois: false,
      estFinDeTrimestre: false,
      estFinDAnnee: false,
      exerciceFiscal: 2026,
      libelleMois: 'Mai 2026',
      libelleJour: null,
    };
    tempsService.findByDate.mockResolvedValue(day);

    const result = await controller.findByDate('2026-05-01');
    expect(result.jourOuvre).toBe(false);
    expect(tempsService.findByDate).toHaveBeenCalledWith('2026-05-01');
  });
});
