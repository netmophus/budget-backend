/**
 * Tests unitaires ScenarioService via pg-mem.
 * Couvre CRUD + transition unique d'archivage (actif → archive).
 */
import { ConflictException, NotFoundException } from '@nestjs/common';
import { DataType, IMemoryDb, newDb } from 'pg-mem';
import { DataSource, Repository } from 'typeorm';

import { ScenarioService } from './scenario.service';
import { DimScenario, TypeScenario } from './entities/dim-scenario.entity';

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
    entities: [DimScenario],
    synchronize: true,
  });
  await ds.initialize();
  return ds;
}

async function rawInsert(
  ds: DataSource,
  attrs: {
    codeScenario: string;
    typeScenario?: TypeScenario;
    statut?: 'actif' | 'archive';
  },
): Promise<string> {
  await ds.query(
    `INSERT INTO dim_scenario
       ("code_scenario","libelle","type_scenario","statut","utilisateur_creation")
     VALUES ($1,$2,$3,$4,'system')`,
    [
      attrs.codeScenario,
      attrs.codeScenario,
      attrs.typeScenario ?? 'central',
      attrs.statut ?? 'actif',
    ],
  );
  const rows = (await ds.query(
    `SELECT id FROM dim_scenario WHERE code_scenario = $1`,
    [attrs.codeScenario],
  )) as Array<{ id: string | number }>;
  return String(rows[0]!.id);
}

describe('ScenarioService', () => {
  let dataSource: DataSource;
  let repo: Repository<DimScenario>;
  let service: ScenarioService;

  beforeAll(async () => {
    dataSource = await createDataSource();
    repo = dataSource.getRepository(DimScenario);
    service = new ScenarioService(repo);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await dataSource.query('DELETE FROM dim_scenario');
  });

  describe('findAll', () => {
    beforeEach(async () => {
      await rawInsert(dataSource, { codeScenario: 'CENTRAL' });
      await rawInsert(dataSource, {
        codeScenario: 'ALTERNATIF_HAUT',
        typeScenario: 'optimiste',
      });
      await rawInsert(dataSource, {
        codeScenario: 'OBSOLETE',
        statut: 'archive',
      });
    });

    it('returns all by default', async () => {
      const res = await service.findAll({ page: 1, limit: 50 });
      expect(res.total).toBe(3);
    });

    it('filters by statut=actif', async () => {
      const res = await service.findAll({
        page: 1,
        limit: 50,
        statut: 'actif',
      });
      expect(res.total).toBe(2);
    });

    it('filters by typeScenario', async () => {
      const res = await service.findAll({
        page: 1,
        limit: 50,
        typeScenario: 'optimiste',
      });
      expect(res.total).toBe(1);
      expect(res.items[0]!.codeScenario).toBe('ALTERNATIF_HAUT');
    });
  });

  describe('create', () => {
    it('creates a scenario with statut=actif', async () => {
      const created = await service.create(
        {
          codeScenario: 'CENTRAL',
          libelle: 'Central',
          typeScenario: 'central',
        },
        'admin@miznas.local',
      );
      expect(created.statut).toBe('actif');
    });

    it('rejects duplicate (409)', async () => {
      await rawInsert(dataSource, { codeScenario: 'CENTRAL' });
      await expect(
        service.create(
          {
            codeScenario: 'CENTRAL',
            libelle: 'Dup',
            typeScenario: 'central',
          },
          'admin',
        ),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('update', () => {
    it('updates libelle when statut=actif', async () => {
      const id = await rawInsert(dataSource, { codeScenario: 'CENTRAL' });
      const updated = await service.update(id, { libelle: 'Renommé' }, 'admin');
      expect(updated.libelle).toBe('Renommé');
    });

    it('refuses update when archived (409)', async () => {
      const id = await rawInsert(dataSource, {
        codeScenario: 'OBSOLETE',
        statut: 'archive',
      });
      await expect(
        service.update(id, { libelle: 'X' }, 'admin'),
      ).rejects.toThrow(ConflictException);
    });

    it('throws NotFoundException for unknown id', async () => {
      await expect(
        service.update('999', { libelle: 'X' }, 'admin'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('archive', () => {
    it('transitions actif → archive', async () => {
      const id = await rawInsert(dataSource, { codeScenario: 'CENTRAL' });
      const archived = await service.archive(id, 'admin@miznas.local');
      expect(archived.statut).toBe('archive');
      expect(archived.utilisateurModification).toBe('admin@miznas.local');
    });

    it('refuses if already archived (409)', async () => {
      const id = await rawInsert(dataSource, {
        codeScenario: 'OBSOLETE',
        statut: 'archive',
      });
      await expect(service.archive(id, 'admin')).rejects.toThrow(
        ConflictException,
      );
    });

    it('throws NotFoundException for unknown id', async () => {
      await expect(service.archive('999', 'admin')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
