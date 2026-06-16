/**
 * Tests TempsService via pg-mem (PostgreSQL en mémoire pur JS).
 * Cf. `common/services/scd2.service.spec.ts` pour les choix techniques
 * communs (registerFunction current_database / version, etc.).
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DataType, IMemoryDb, newDb } from 'pg-mem';
import { DataSource, Repository } from 'typeorm';

import { AuditService } from '../../audit/audit.service';
import { DimTemps } from './entities/dim-temps.entity';
import { TempsService } from './temps.service';

const auditMock = { log: jest.fn() } as unknown as AuditService;

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
  const ds: DataSource = db.adapters.createTypeormDataSource({
    type: 'postgres',
    entities: [DimTemps],
    synchronize: true,
  });
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
      jourOuvre: false,
      estFinDeMois: false,
      estFinDeTrimestre: false,
      estFinDAnnee: false,
      exerciceFiscal: 2026,
      libelleMois: 'Janv. 2026',
      ...partial,
    } as DimTemps),
  );
}

describe('TempsService', () => {
  let dataSource: DataSource;
  let repo: Repository<DimTemps>;
  let service: TempsService;

  beforeAll(async () => {
    dataSource = await createDataSource();
    repo = dataSource.getRepository(DimTemps);
    service = new TempsService(repo, auditMock);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await dataSource.query('DELETE FROM dim_temps');
  });

  describe('findOne', () => {
    it('returns the row by id', async () => {
      const row = await insertDay(repo, { date: '2026-05-01' });
      const result = await service.findOne(row.id);
      expect(result.date).toBe('2026-05-01');
    });

    it('throws NotFoundException when missing', async () => {
      await expect(service.findOne('999999')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findByDate', () => {
    it('returns the row by ISO date', async () => {
      await insertDay(repo, { date: '2026-05-01', jourOuvre: false });
      const result = await service.findByDate('2026-05-01');
      expect(result.date).toBe('2026-05-01');
      expect(result.jourOuvre).toBe(false);
    });

    it('throws BadRequestException for an invalid date format', async () => {
      await expect(service.findByDate('2026/05/01')).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.findByDate('not-a-date')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws NotFoundException for a missing date', async () => {
      await expect(service.findByDate('2099-01-01')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findRange', () => {
    it('returns days between two dates (inclusive), ordered ASC', async () => {
      await insertDay(repo, { date: '2026-01-01' });
      await insertDay(repo, { date: '2026-01-02' });
      await insertDay(repo, { date: '2026-01-03' });
      await insertDay(repo, { date: '2026-02-01' });

      const range = await service.findRange('2026-01-02', '2026-01-03');
      expect(range.map((r) => r.date)).toEqual(['2026-01-02', '2026-01-03']);
    });
  });

  describe('findByMois', () => {
    it('returns all days of a given annee+mois', async () => {
      await insertDay(repo, { date: '2026-01-15', annee: 2026, mois: 1 });
      await insertDay(repo, { date: '2026-01-31', annee: 2026, mois: 1 });
      await insertDay(repo, { date: '2026-02-01', annee: 2026, mois: 2 });

      const jours = await service.findByMois(2026, 1);
      expect(jours).toHaveLength(2);
      expect(jours.map((j) => j.date)).toEqual(['2026-01-15', '2026-01-31']);
    });
  });

  describe('findExercice', () => {
    it('returns all days of a given exercice fiscal', async () => {
      await insertDay(repo, { date: '2026-12-31', exerciceFiscal: 2026 });
      await insertDay(repo, { date: '2027-01-01', exerciceFiscal: 2027 });

      const result = await service.findExercice(2026);
      expect(result).toHaveLength(1);
      expect(result[0]!.date).toBe('2026-12-31');
    });
  });

  describe('findAll', () => {
    it('paginates with defaults and orders by date', async () => {
      for (let d = 1; d <= 5; d++) {
        await insertDay(repo, {
          date: `2026-01-0${d}`,
          jour: d,
        });
      }

      const result = await service.findAll({ page: 1, limit: 366 });
      expect(result.total).toBe(5);
      expect(result.items[0]!.date).toBe('2026-01-01');
    });

    it('filters by annee + mois', async () => {
      await insertDay(repo, { date: '2026-01-15', annee: 2026, mois: 1 });
      await insertDay(repo, { date: '2026-02-15', annee: 2026, mois: 2 });

      const result = await service.findAll({
        page: 1,
        limit: 366,
        annee: 2026,
        mois: 1,
      });
      expect(result.total).toBe(1);
      expect(result.items[0]!.date).toBe('2026-01-15');
    });

    it('filters by date range', async () => {
      await insertDay(repo, { date: '2026-01-01' });
      await insertDay(repo, { date: '2026-06-15' });
      await insertDay(repo, { date: '2026-12-31' });

      const result = await service.findAll({
        page: 1,
        limit: 366,
        dateDebut: '2026-06-01',
        dateFin: '2026-12-31',
      });
      expect(result.total).toBe(2);
    });
  });
});
