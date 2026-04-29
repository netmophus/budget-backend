/**
 * Tests unitaires VersionService via pg-mem.
 *
 * Couvre :
 *  - findAll avec filtres exerciceFiscal / statut / typeVersion
 *  - findByCode (404 si absent)
 *  - create (refus doublon)
 *  - update / softDelete : refus si statut != 'ouvert' (409 Conflict)
 */
import {
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { DataType, IMemoryDb, newDb } from 'pg-mem';
import { DataSource, Repository } from 'typeorm';

import { VersionService } from './version.service';
import { DimVersion } from './entities/dim-version.entity';

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
    entities: [DimVersion],
    synchronize: true,
  });
  await ds.initialize();
  return ds;
}

async function rawInsert(
  ds: DataSource,
  attrs: {
    codeVersion: string;
    libelle?: string;
    typeVersion?: 'budget_initial' | 'reforecast_1' | 'reforecast_2' | 'atterrissage';
    exerciceFiscal?: number;
    statut?: 'ouvert' | 'soumis' | 'valide' | 'gele';
  },
): Promise<string> {
  await ds.query(
    `INSERT INTO dim_version
       ("code_version","libelle","type_version","exercice_fiscal",
        "statut","utilisateur_creation")
     VALUES ($1,$2,$3,$4,$5,'system')`,
    [
      attrs.codeVersion,
      attrs.libelle ?? attrs.codeVersion,
      attrs.typeVersion ?? 'budget_initial',
      attrs.exerciceFiscal ?? 2026,
      attrs.statut ?? 'ouvert',
    ],
  );
  const rows = (await ds.query(
    `SELECT id FROM dim_version WHERE code_version = $1`,
    [attrs.codeVersion],
  )) as Array<{ id: string | number }>;
  return String(rows[0]!.id);
}

describe('VersionService', () => {
  let dataSource: DataSource;
  let repo: Repository<DimVersion>;
  let service: VersionService;

  beforeAll(async () => {
    dataSource = await createDataSource();
    repo = dataSource.getRepository(DimVersion);
    service = new VersionService(repo);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await dataSource.query('DELETE FROM dim_version');
  });

  describe('findAll', () => {
    beforeEach(async () => {
      await rawInsert(dataSource, {
        codeVersion: 'BUDGET_INITIAL_2026',
        typeVersion: 'budget_initial',
        exerciceFiscal: 2026,
      });
      await rawInsert(dataSource, {
        codeVersion: 'RF1_2026',
        typeVersion: 'reforecast_1',
        exerciceFiscal: 2026,
        statut: 'soumis',
      });
      await rawInsert(dataSource, {
        codeVersion: 'BUDGET_INITIAL_2025',
        typeVersion: 'budget_initial',
        exerciceFiscal: 2025,
        statut: 'gele',
      });
    });

    it('returns all when no filter', async () => {
      const res = await service.findAll({ page: 1, limit: 50 });
      expect(res.total).toBe(3);
    });

    it('filters by exerciceFiscal', async () => {
      const res = await service.findAll({
        page: 1,
        limit: 50,
        exerciceFiscal: 2026,
      });
      expect(res.total).toBe(2);
    });

    it('filters by statut', async () => {
      const res = await service.findAll({
        page: 1,
        limit: 50,
        statut: 'gele',
      });
      expect(res.total).toBe(1);
      expect(res.items[0]!.codeVersion).toBe('BUDGET_INITIAL_2025');
    });

    it('filters by typeVersion', async () => {
      const res = await service.findAll({
        page: 1,
        limit: 50,
        typeVersion: 'reforecast_1',
      });
      expect(res.total).toBe(1);
    });
  });

  describe('findByCode', () => {
    it('returns the version when present', async () => {
      await rawInsert(dataSource, { codeVersion: 'BUDGET_INITIAL_2026' });
      const v = await service.findByCode('BUDGET_INITIAL_2026');
      expect(v.codeVersion).toBe('BUDGET_INITIAL_2026');
    });

    it('throws NotFoundException when missing', async () => {
      await expect(service.findByCode('UNKNOWN')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('create', () => {
    it('creates a version with statut=ouvert', async () => {
      const created = await service.create(
        {
          codeVersion: 'BUDGET_INITIAL_2026',
          libelle: 'Budget initial 2026',
          typeVersion: 'budget_initial',
          exerciceFiscal: 2026,
        },
        'admin@miznas.local',
      );
      expect(created.statut).toBe('ouvert');
    });

    it('rejects duplicate codeVersion (409)', async () => {
      await rawInsert(dataSource, { codeVersion: 'BUDGET_INITIAL_2026' });
      await expect(
        service.create(
          {
            codeVersion: 'BUDGET_INITIAL_2026',
            libelle: 'Dup',
            typeVersion: 'budget_initial',
            exerciceFiscal: 2026,
          },
          'admin',
        ),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('update', () => {
    it('updates libelle when statut=ouvert', async () => {
      const id = await rawInsert(dataSource, {
        codeVersion: 'BUDGET_INITIAL_2026',
      });
      const updated = await service.update(
        id,
        { libelle: 'Renommé' },
        'admin@miznas.local',
      );
      expect(updated.libelle).toBe('Renommé');
      expect(updated.utilisateurModification).toBe('admin@miznas.local');
    });

    it('refuses update when statut=soumis (409)', async () => {
      const id = await rawInsert(dataSource, {
        codeVersion: 'BUDGET_INITIAL_2026',
        statut: 'soumis',
      });
      await expect(
        service.update(id, { libelle: 'X' }, 'admin'),
      ).rejects.toThrow(ConflictException);
    });

    it('refuses update when statut=gele (409)', async () => {
      const id = await rawInsert(dataSource, {
        codeVersion: 'BUDGET_INITIAL_2026',
        statut: 'gele',
      });
      await expect(
        service.update(id, { libelle: 'X' }, 'admin'),
      ).rejects.toThrow(/'gele'/);
    });

    it('throws NotFoundException for unknown id', async () => {
      await expect(
        service.update('999', { libelle: 'X' }, 'admin'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('softDelete', () => {
    it('deletes when statut=ouvert', async () => {
      const id = await rawInsert(dataSource, {
        codeVersion: 'BUDGET_INITIAL_2026',
      });
      const ok = await service.softDelete(id);
      expect(ok).toBe(true);
      const rows = (await dataSource.query(
        `SELECT COUNT(*)::int AS c FROM dim_version`,
      )) as Array<{ c: number }>;
      expect(rows[0]!.c).toBe(0);
    });

    it('refuses delete when statut=valide (409)', async () => {
      const id = await rawInsert(dataSource, {
        codeVersion: 'BUDGET_INITIAL_2026',
        statut: 'valide',
      });
      await expect(service.softDelete(id)).rejects.toThrow(
        ConflictException,
      );
    });

    it('returns false when id unknown', async () => {
      expect(await service.softDelete('999')).toBe(false);
    });
  });
});
