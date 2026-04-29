import { Test, TestingModule } from '@nestjs/testing';

import { DeviseController } from './devise.controller';
import { DeviseService } from './devise.service';

describe('DeviseController', () => {
  let controller: DeviseController;
  let service: jest.Mocked<DeviseService>;

  const adminUser = { userId: '1', email: 'admin@miznas.local' };

  beforeEach(async () => {
    service = {
      findAll: jest.fn(),
      findOne: jest.fn(),
      findByCodeIso: jest.fn(),
      findPivot: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      desactiver: jest.fn(),
    } as unknown as jest.Mocked<DeviseService>;

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [DeviseController],
      providers: [{ provide: DeviseService, useValue: service }],
    }).compile();

    controller = moduleRef.get(DeviseController);
  });

  it('findAll delegates with the parsed query DTO', async () => {
    const dto = { items: [], total: 0, page: 1, limit: 50 };
    service.findAll.mockResolvedValue(dto);
    const result = await controller.findAll({ page: 1, limit: 50 });
    expect(result).toBe(dto);
    expect(service.findAll).toHaveBeenCalledWith({ page: 1, limit: 50 });
  });

  it('findPivot delegates', async () => {
    const xof = { codeIso: 'XOF' } as never;
    service.findPivot.mockResolvedValue(xof);
    expect(await controller.findPivot()).toBe(xof);
  });

  it('create delegates and forwards the user email', async () => {
    const created = { codeIso: 'JPY' } as never;
    service.create.mockResolvedValue(created);

    await controller.create(
      { codeIso: 'JPY', libelle: 'Yen japonais' },
      adminUser,
    );

    expect(service.create).toHaveBeenCalledWith(
      { codeIso: 'JPY', libelle: 'Yen japonais' },
      'admin@miznas.local',
    );
  });

  it('update delegates with id, dto and the user email', async () => {
    const updated = { id: '1', libelle: 'New' } as never;
    service.update.mockResolvedValue(updated);

    await controller.update('1', { libelle: 'New' }, adminUser);

    expect(service.update).toHaveBeenCalledWith(
      '1',
      { libelle: 'New' },
      'admin@miznas.local',
    );
  });

  it('desactiver delegates and returns void', async () => {
    service.desactiver.mockResolvedValue({ id: '1' } as never);
    const result = await controller.desactiver('1', adminUser);
    expect(result).toBeUndefined();
    expect(service.desactiver).toHaveBeenCalledWith('1', 'admin@miznas.local');
  });
});
