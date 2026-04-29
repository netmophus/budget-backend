import { Test, TestingModule } from '@nestjs/testing';
import type { Request } from 'express';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';

function makeReq(): Request {
  return {
    ip: '127.0.0.1',
    headers: { 'user-agent': 'jest' },
  } as unknown as Request;
}

describe('AuditController', () => {
  let controller: AuditController;
  let service: jest.Mocked<AuditService>;

  beforeEach(async () => {
    service = {
      findAll: jest.fn(),
      findOne: jest.fn(),
    } as unknown as jest.Mocked<AuditService>;

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [AuditController],
      providers: [{ provide: AuditService, useValue: service }],
    }).compile();

    controller = moduleRef.get(AuditController);
  });

  it('findAll forwards caller context to AuditService for meta-audit', async () => {
    const dto = { items: [], total: 0, page: 1, limit: 50 };
    service.findAll.mockResolvedValue(dto);

    await controller.findAll(
      { page: 1, limit: 50 },
      { userId: '1', email: 'admin@miznas.local' },
      makeReq(),
    );

    expect(service.findAll).toHaveBeenCalledWith(
      { page: 1, limit: 50 },
      expect.objectContaining({
        caller: 'admin@miznas.local',
        ipSource: '127.0.0.1',
        userAgent: 'jest',
      }),
    );
  });

  it('findOne delegates by id', async () => {
    const row = {
      id: '1',
      dateAction: new Date(),
      utilisateur: 'admin@miznas.local',
      ipSource: null,
      userAgent: null,
      typeAction: 'LOGIN',
      entiteCible: 'auth',
      idCible: '1',
      payloadAvant: null,
      payloadApres: null,
      commentaire: null,
      statut: 'success',
      dureeMs: null,
    };
    service.findOne.mockResolvedValue(row);
    expect(await controller.findOne('1')).toBe(row);
  });
});
