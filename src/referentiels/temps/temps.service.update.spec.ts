/**
 * Lot 8.7.A — tests TempsService.updateJour + etendreCalendrier (pg-mem).
 * Même harnais que temps.service.spec.ts.
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DataType, IMemoryDb, newDb } from 'pg-mem';
import { DataSource, Repository } from 'typeorm';

import { AuthUser } from '../../auth/decorators/current-user.decorator';
import { AuditService } from '../../audit/audit.service';
import { DimTemps } from './entities/dim-temps.entity';
import { TempsService } from './temps.service';

const USER: AuthUser = { userId: '1', email: 'admin@miznas.local' };

function buildMemDb(): IMemoryDb {
  const db = newDb({ autoCreateForeignKeyIndices: true });
  db.public.registerFunction({
    name: 'current_database',
    args: [],
    returns: DataType.text,
    implementation: () => 'test',
  });
  db.public.registerFunction({
    name: 'version',
    args: [],
    returns: DataType.text,
    implementation: () => 'PostgreSQL 15 (pg-mem)',
  });
  return db;
}

async function createDataSource(): Promise<DataSource> {
  const db = buildMemDb();
  const ds = db.adapters.createTypeormDataSource({
    type: 'postgres',
    entities: [DimTemps],
    synchronize: true,
  }) as DataSource;
  await ds.initialize();
  return ds;
}

async function insertDay(
  repo: Repository<DimTemps>,
  partial: Partial<DimTemps>,
): Promise<DimTemps> {
  return repo.save(
    repo.create({
      date: '2026-01-01',
      annee: 2026,
      trimestre: 1,
      mois: 1,
      jour: 1,
      semaineIso: 1,
      jourOuvre: true,
      estFinDeMois: false,
      estFinDeTrimestre: false,
      estFinDAnnee: false,
      exerciceFiscal: 2026,
      libelleMois: 'Janv. 2026',
      libelleJour: null,
      ...partial,
    } as DimTemps),
  );
}

describe('TempsService — édition (Lot 8.7.A)', () => {
  let dataSource: DataSource;
  let repo: Repository<DimTemps>;
  let service: TempsService;
  let auditLog: jest.Mock;

  beforeAll(async () => {
    dataSource = await createDataSource();
    repo = dataSource.getRepository(DimTemps);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await dataSource.query('DELETE FROM dim_temps');
    auditLog = jest.fn();
    const audit = { log: auditLog } as unknown as AuditService;
    service = new TempsService(repo, audit);
  });

  describe('updateJour', () => {
    it('bascule jour_ouvre et pose un libellé férié + audit', async () => {
      const row = await insertDay(repo, {
        date: '2027-06-16',
        jourOuvre: true,
      });

      const result = await service.updateJour(
        row.id,
        { jourOuvre: false, libelleJour: 'Tabaski 2027' },
        USER,
      );

      expect(result.jourOuvre).toBe(false);
      expect(result.libelleJour).toBe('Tabaski 2027');
      expect(auditLog).toHaveBeenCalledTimes(1);
      expect(auditLog.mock.calls[0][0]).toMatchObject({
        typeAction: 'MODIFIER_JOUR_CALENDRIER',
        entiteCible: 'dim_temps',
        idCible: row.id,
        statut: 'success',
      });
    });

    it('met à jour libelle_jour seul sans toucher les autres champs', async () => {
      const row = await insertDay(repo, {
        date: '2027-04-14',
        jourOuvre: false,
      });

      const result = await service.updateJour(
        row.id,
        { libelleJour: 'Mawlid 2027' },
        USER,
      );

      expect(result.libelleJour).toBe('Mawlid 2027');
      expect(result.jourOuvre).toBe(false);
    });

    it('ignore les champs calculés non whitelistés (date, annee)', async () => {
      const row = await insertDay(repo, { date: '2027-01-02', annee: 2027 });

      const result = await service.updateJour(
        row.id,
        { jourOuvre: false, date: '2099-12-31', annee: 2099 } as never,
        USER,
      );

      expect(result.date).toBe('2027-01-02');
      expect(result.annee).toBe(2027);
      expect(result.jourOuvre).toBe(false);
    });

    it('lève NotFoundException si le jour est inconnu', async () => {
      await expect(
        service.updateJour('999999', { jourOuvre: false }, USER),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('etendreCalendrier', () => {
    it('génère une année et reste idempotent + audit', async () => {
      const first = await service.etendreCalendrier(
        { anneeDebut: 2031, anneeFin: 2031 },
        USER,
      );
      expect(first.nbJoursAjoutes).toBe(365);
      expect(await repo.count()).toBe(365);

      const second = await service.etendreCalendrier(
        { anneeDebut: 2031, anneeFin: 2031 },
        USER,
      );
      expect(second.nbJoursAjoutes).toBe(0);
      expect(await repo.count()).toBe(365);

      expect(auditLog).toHaveBeenCalledTimes(2);
      expect(auditLog.mock.calls[0][0]).toMatchObject({
        typeAction: 'ETENDRE_CALENDRIER',
        entiteCible: 'dim_temps',
      });
    });

    it('rejette anneeFin < anneeDebut', async () => {
      await expect(
        service.etendreCalendrier({ anneeDebut: 2032, anneeFin: 2031 }, USER),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
