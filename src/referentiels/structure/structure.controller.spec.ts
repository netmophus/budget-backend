import { Test, TestingModule } from '@nestjs/testing';

import { StructureController } from './structure.controller';
import { StructureService } from './structure.service';

describe('StructureController', () => {
  let controller: StructureController;
  let service: jest.Mocked<StructureService>;

  const adminUser = { userId: '1', email: 'admin@miznas.local' };

  beforeEach(async () => {
    service = {
      findAllPaginated: jest.fn(),
      findOneResponse: jest.fn(),
      findCurrentByCode: jest.fn(),
      findHistoryByCode: jest.fn(),
      findChildren: jest.fn(),
      findDescendants: jest.fn(),
      findAncestors: jest.fn(),
      findRoots: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      desactiver: jest.fn(),
    } as unknown as jest.Mocked<StructureService>;

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [StructureController],
      providers: [{ provide: StructureService, useValue: service }],
    }).compile();

    controller = moduleRef.get(StructureController);
  });

  it('findAll delegates with the parsed query', async () => {
    const dto = { items: [], total: 0, page: 1, limit: 50 };
    service.findAllPaginated.mockResolvedValue(dto);
    const result = await controller.findAll({
      page: 1,
      limit: 50,
      versionCouranteUniquement: true,
    });
    expect(result).toBe(dto);
  });

  it('create delegates and forwards the user email', async () => {
    const created = { codeStructure: 'AG_X' } as never;
    service.create.mockResolvedValue(created);

    await controller.create(
      {
        codeStructure: 'AG_X',
        libelle: 'X',
        typeStructure: 'agence',
        niveauHierarchique: 5,
      },
      adminUser,
    );

    expect(service.create).toHaveBeenCalledWith(
      expect.objectContaining({ codeStructure: 'AG_X' }),
      'admin@miznas.local',
    );
  });

  it('update delegates with codeStructure, dto, user', async () => {
    const updated = { codeStructure: 'AG_X' } as never;
    service.update.mockResolvedValue(updated);

    await controller.update('AG_X', { libelle: 'New' }, adminUser);

    expect(service.update).toHaveBeenCalledWith(
      'AG_X',
      { libelle: 'New' },
      'admin@miznas.local',
    );
  });

  it('desactiver delegates and returns void', async () => {
    service.desactiver.mockResolvedValue();
    const result = await controller.desactiver('AG_X', adminUser);
    expect(result).toBeUndefined();
  });

  it('findChildren / findDescendants / findAncestors / findRoots delegate', async () => {
    service.findChildren.mockResolvedValue([]);
    service.findDescendants.mockResolvedValue([]);
    service.findAncestors.mockResolvedValue([]);
    service.findRoots.mockResolvedValue([]);

    await controller.findChildren('1');
    await controller.findDescendants('1');
    await controller.findAncestors('1');
    await controller.findRoots();

    expect(service.findChildren).toHaveBeenCalledWith('1');
    expect(service.findDescendants).toHaveBeenCalledWith('1');
    expect(service.findAncestors).toHaveBeenCalledWith('1');
    expect(service.findRoots).toHaveBeenCalled();
  });
});
