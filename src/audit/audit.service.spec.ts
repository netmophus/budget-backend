import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditService } from './audit.service';
import { AuditLog } from './entities/audit-log.entity';

describe('AuditService', () => {
  let service: AuditService;
  let repo: jest.Mocked<
    Pick<Repository<AuditLog>, 'insert' | 'findAndCount' | 'findOne'>
  >;

  beforeEach(async () => {
    repo = {
      insert: jest.fn().mockResolvedValue(undefined),
      findAndCount: jest.fn().mockResolvedValue([[], 0]),
      findOne: jest.fn(),
    };
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        AuditService,
        { provide: getRepositoryToken(AuditLog), useValue: repo },
      ],
    }).compile();
    service = moduleRef.get(AuditService);
  });

  it('log() inserts a row with default nulls applied', async () => {
    await service.log({
      utilisateur: 'admin@miznas.local',
      typeAction: 'LOGIN',
      entiteCible: 'auth',
      statut: 'success',
    });
    expect(repo.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        utilisateur: 'admin@miznas.local',
        typeAction: 'LOGIN',
        entiteCible: 'auth',
        statut: 'success',
        ipSource: null,
        userAgent: null,
        idCible: null,
        payloadAvant: null,
        payloadApres: null,
        commentaire: null,
        dureeMs: null,
      }),
    );
  });

  it('log() truncates user-agent over 500 chars', async () => {
    const ua = 'X'.repeat(800);
    await service.log({
      utilisateur: 'a@b.c',
      typeAction: 'LOGIN',
      entiteCible: 'auth',
      statut: 'success',
      userAgent: ua,
    });
    const call = repo.insert.mock.calls[0][0];
    expect((call as { userAgent: string }).userAgent.length).toBe(500);
  });

  it('log() does not mutate the payload (sanitization handled upstream)', async () => {
    const payload = { body: { motDePasse: 'secret' } };
    await service.log({
      utilisateur: 'a@b.c',
      typeAction: 'CREATE',
      entiteCible: 'user',
      statut: 'success',
      payloadApres: payload,
    });
    // Service writes whatever is given. Sanitization is the interceptor's job.
    expect(payload.body.motDePasse).toBe('secret');
  });

  it('findAll() applies pagination and orders DESC', async () => {
    repo.findAndCount.mockResolvedValue([[], 0]);
    await service.findAll({ page: 2, limit: 25 });
    const call = repo.findAndCount.mock.calls[0][0]!;
    expect(call.skip).toBe(25);
    expect(call.take).toBe(25);
    expect(call.order).toMatchObject({ dateAction: 'DESC', id: 'DESC' });
  });

  it('findAll() with caller != system writes a LIRE_AUDIT meta-trail', async () => {
    await service.findAll(
      { page: 1, limit: 50 },
      { caller: 'admin@miznas.local' },
    );
    expect(repo.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        utilisateur: 'admin@miznas.local',
        typeAction: 'LIRE_AUDIT',
        entiteCible: 'audit_log',
      }),
    );
  });

  it('findAll() with caller=system does not meta-audit (avoids loops)', async () => {
    await service.findAll({ page: 1, limit: 50 }, { caller: 'system' });
    expect(repo.insert).not.toHaveBeenCalled();
  });

  it('findAll() applies dateDebut + dateFin filter (Between)', async () => {
    repo.findAndCount.mockResolvedValue([[], 0]);
    await service.findAll({
      page: 1,
      limit: 50,
      dateDebut: '2026-04-01T00:00:00.000Z',
      dateFin: '2026-04-30T23:59:59.999Z',
    });
    const where = (repo.findAndCount.mock.calls[0][0]!.where ?? {}) as Record<
      string,
      unknown
    >;
    expect(where.dateAction).toBeDefined();
  });

  it('findAll() applies dateDebut alone (>=) and dateFin alone (<=)', async () => {
    repo.findAndCount.mockResolvedValue([[], 0]);
    await service.findAll({
      page: 1,
      limit: 50,
      dateDebut: '2026-04-01T00:00:00.000Z',
    });
    expect(repo.findAndCount.mock.calls[0][0]!.where).toBeDefined();

    repo.findAndCount.mockClear();
    await service.findAll({
      page: 1,
      limit: 50,
      dateFin: '2026-04-30T23:59:59.999Z',
    });
    expect(repo.findAndCount.mock.calls[0][0]!.where).toBeDefined();
  });

  it('findAll() applies utilisateur, typeAction, entiteCible, idCible, statut filters', async () => {
    repo.findAndCount.mockResolvedValue([[], 0]);
    await service.findAll({
      page: 1,
      limit: 50,
      utilisateur: 'admin@miznas.local',
      typeAction: 'LOGIN',
      entiteCible: 'auth',
      idCible: '1',
      statut: 'success',
    });
    const where = (repo.findAndCount.mock.calls[0][0]!.where ?? {}) as Record<
      string,
      unknown
    >;
    expect(where.utilisateur).toBe('admin@miznas.local');
    expect(where.typeAction).toBe('LOGIN');
    expect(where.entiteCible).toBe('auth');
    expect(where.idCible).toBe('1');
    expect(where.statut).toBe('success');
  });

  it('findOne throws NotFoundException when missing', async () => {
    repo.findOne.mockResolvedValue(null);
    await expect(service.findOne('999')).rejects.toThrow(/introuvable/);
  });

  it('findOne returns mapped DTO when found', async () => {
    repo.findOne.mockResolvedValue({
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
    } as never);
    const result = await service.findOne('1');
    expect(result.typeAction).toBe('LOGIN');
  });
});
