/**
 * Tests unitaires CentreResponsabiliteService via pg-mem.
 *
 * Cf. notes pg-mem documentées dans `structure.service.spec.ts` :
 *  - bigint retourné en number (coerce avec String())
 *  - FK avec ON DELETE RESTRICT bloque DELETE → NULL avant DELETE
 *  - WITH RECURSIVE non supporté (non utilisé ici)
 *  - Index unique partiel non créé par synchronize → invariant
 *    porté par Scd2Service runtime
 */
import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DataType, IMemoryDb, newDb } from 'pg-mem';
import { DataSource, Repository } from 'typeorm';

import { CentreResponsabiliteService } from './centre-responsabilite.service';
import { DimCentreResponsabilite } from './entities/dim-centre-responsabilite.entity';
import { DimStructure } from '../structure/entities/dim-structure.entity';
import { StructureService } from '../structure/structure.service';

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
    entities: [DimStructure, DimCentreResponsabilite],
    synchronize: true,
  });
  await ds.initialize();
  return ds;
}

async function insertStructure(
  ds: DataSource,
  partial: {
    codeStructure: string;
    libelle?: string;
    typeStructure?: string;
    niveauHierarchique?: number;
    dateDebutValidite?: string;
    versionCourante?: boolean;
  },
): Promise<string> {
  const today = new Date().toISOString().slice(0, 10);
  await ds.query(
    `INSERT INTO dim_structure
       ("code_structure","libelle","type_structure","niveau_hierarchique",
        "fk_structure_parent","code_pays","date_debut_validite",
        "date_fin_validite","version_courante","est_actif","utilisateur_creation")
     VALUES ($1,$2,$3,$4,NULL,NULL,$5,NULL,$6,true,'system')`,
    [
      partial.codeStructure,
      partial.libelle ?? partial.codeStructure,
      partial.typeStructure ?? 'entite_juridique',
      partial.niveauHierarchique ?? 1,
      partial.dateDebutValidite ?? today,
      partial.versionCourante ?? true,
    ],
  );
  const rows = (await ds.query(
    `SELECT id FROM dim_structure WHERE code_structure = $1
     AND version_courante = $2 ORDER BY id DESC LIMIT 1`,
    [partial.codeStructure, partial.versionCourante ?? true],
  )) as Array<{ id: string | number }>;
  return String(rows[0]!.id);
}

async function insertCr(
  ds: DataSource,
  partial: {
    codeCr: string;
    libelle?: string;
    typeCr?: string;
    fkStructure: string;
    dateDebutValidite?: string;
    versionCourante?: boolean;
    estActif?: boolean;
  },
): Promise<string> {
  const today = new Date().toISOString().slice(0, 10);
  await ds.query(
    `INSERT INTO dim_centre_responsabilite
       ("code_cr","libelle","type_cr","fk_structure",
        "date_debut_validite","date_fin_validite","version_courante",
        "est_actif","utilisateur_creation")
     VALUES ($1,$2,$3,$4,$5,NULL,$6,$7,'system')`,
    [
      partial.codeCr,
      partial.libelle ?? partial.codeCr,
      partial.typeCr ?? 'cdp',
      partial.fkStructure,
      partial.dateDebutValidite ?? today,
      partial.versionCourante ?? true,
      partial.estActif ?? true,
    ],
  );
  const rows = (await ds.query(
    `SELECT id FROM dim_centre_responsabilite WHERE code_cr = $1
     AND version_courante = $2 ORDER BY id DESC LIMIT 1`,
    [partial.codeCr, partial.versionCourante ?? true],
  )) as Array<{ id: string | number }>;
  return String(rows[0]!.id);
}

describe('CentreResponsabiliteService', () => {
  let dataSource: DataSource;
  let crRepo: Repository<DimCentreResponsabilite>;
  let structureRepo: Repository<DimStructure>;
  let structureService: StructureService;
  let service: CentreResponsabiliteService;

  beforeAll(async () => {
    dataSource = await createDataSource();
    crRepo = dataSource.getRepository(DimCentreResponsabilite);
    structureRepo = dataSource.getRepository(DimStructure);
    // crService est passé undefined ici — le hook de relink ne sera
    // pas exercé via StructureService (testé séparément en e2e).
    structureService = new StructureService(
      structureRepo,
      dataSource,
      undefined,
    );
    service = new CentreResponsabiliteService(
      crRepo,
      dataSource,
      structureService,
    );
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await dataSource.query('DELETE FROM dim_centre_responsabilite');
    await dataSource.query(
      'UPDATE dim_structure SET fk_structure_parent = NULL',
    );
    await dataSource.query('DELETE FROM dim_structure');
  });

  // ─── SCD2 hérité — smoke

  describe('SCD2 inherited (smoke)', () => {
    it('findCurrent returns the row with versionCourante=true', async () => {
      const sId = await insertStructure(dataSource, { codeStructure: 'SOC' });
      await insertCr(dataSource, { codeCr: 'X', fkStructure: sId });
      const current = await service.findCurrent('X');
      expect(current?.codeCr).toBe('X');
    });

    it('findHistory returns versions chronologically', async () => {
      const sId = await insertStructure(dataSource, { codeStructure: 'SOC' });
      await insertCr(dataSource, {
        codeCr: 'X',
        libelle: 'V1',
        fkStructure: sId,
        dateDebutValidite: '2024-01-01',
        versionCourante: false,
      });
      await insertCr(dataSource, {
        codeCr: 'X',
        libelle: 'V2',
        fkStructure: sId,
        dateDebutValidite: '2025-01-01',
      });
      const history = await service.findHistory('X');
      expect(history.map((h) => h.libelle)).toEqual(['V1', 'V2']);
    });
  });

  // ─── findByStructure

  describe('findByStructure', () => {
    it('returns CRs attached to a given structure (current versions only)', async () => {
      const sId = await insertStructure(dataSource, { codeStructure: 'SOC' });
      await insertCr(dataSource, { codeCr: 'A', fkStructure: sId });
      await insertCr(dataSource, { codeCr: 'B', fkStructure: sId });
      const otherSId = await insertStructure(dataSource, {
        codeStructure: 'OTHER',
      });
      await insertCr(dataSource, { codeCr: 'C', fkStructure: otherSId });

      const crs = await service.findByStructure(sId);
      expect(crs.map((c) => c.codeCr).sort()).toEqual(['A', 'B']);
    });
  });

  // ─── create / update / desactiver

  describe('create', () => {
    it('creates a CR linked to a current structure (resolved by codeStructure)', async () => {
      await insertStructure(dataSource, { codeStructure: 'SOC' });
      const created = await service.create(
        {
          codeCr: 'CR_NEW',
          libelle: 'Nouveau CR',
          typeCr: 'cdp',
          codeStructure: 'SOC',
        },
        'admin@miznas.local',
      );
      expect(created.codeCr).toBe('CR_NEW');
      expect(created.fkStructure).toBeDefined();
    });

    it('rejects creation when codeStructure does not exist', async () => {
      await expect(
        service.create(
          {
            codeCr: 'CR_X',
            libelle: 'X',
            typeCr: 'cdp',
            codeStructure: 'INEXISTANTE',
          },
          'admin@miznas.local',
        ),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('rejects creation when neither fkStructure nor codeStructure is provided', async () => {
      await expect(
        service.create(
          {
            codeCr: 'CR_X',
            libelle: 'X',
            typeCr: 'cdp',
          },
          'admin@miznas.local',
        ),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('rejects creation when codeCr already has a current version', async () => {
      const sId = await insertStructure(dataSource, { codeStructure: 'SOC' });
      await insertCr(dataSource, { codeCr: 'CR_X', fkStructure: sId });
      await expect(
        service.create(
          {
            codeCr: 'CR_X',
            libelle: 'Doublon',
            typeCr: 'cdp',
            fkStructure: sId,
          },
          'admin@miznas.local',
        ),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('update (4-cas)', () => {
    it('changing libelle on a past version → modeMaj=nouvelle_version (2 rows)', async () => {
      const sId = await insertStructure(dataSource, { codeStructure: 'SOC' });
      await insertCr(dataSource, {
        codeCr: 'CR_X',
        libelle: 'Original',
        fkStructure: sId,
        dateDebutValidite: '2024-01-01',
      });

      const updated = await service.update(
        'CR_X',
        { libelle: 'Renommé' },
        'admin@miznas.local',
      );
      expect(updated.libelle).toBe('Renommé');
      expect(updated.modeMaj).toBe('nouvelle_version');

      const history = await service.findHistory('CR_X');
      expect(history).toHaveLength(2);
    });

    it('changing libelle on TODAY version → modeMaj=ecrasement_intra_jour (still 1 row)', async () => {
      const sId = await insertStructure(dataSource, { codeStructure: 'SOC' });
      await insertCr(dataSource, {
        codeCr: 'CR_X',
        libelle: 'Original',
        fkStructure: sId,
        // dateDebutValidite défaut = today
      });

      const updated = await service.update(
        'CR_X',
        { libelle: 'Renommé' },
        'admin@miznas.local',
      );
      expect(updated.modeMaj).toBe('ecrasement_intra_jour');

      const history = await service.findHistory('CR_X');
      expect(history).toHaveLength(1);
      expect(history[0]!.libelle).toBe('Renommé');
    });

    it('changing only estActif → modeMaj=in_place_est_actif (still 1 row)', async () => {
      const sId = await insertStructure(dataSource, { codeStructure: 'SOC' });
      await insertCr(dataSource, {
        codeCr: 'CR_X',
        fkStructure: sId,
        dateDebutValidite: '2024-01-01',
      });

      const updated = await service.update(
        'CR_X',
        { estActif: false },
        'admin@miznas.local',
      );
      expect(updated.modeMaj).toBe('in_place_est_actif');
      expect(updated.estActif).toBe(false);

      const history = await service.findHistory('CR_X');
      expect(history).toHaveLength(1);
    });

    it('rejects update when the new structure does not exist', async () => {
      const sId = await insertStructure(dataSource, { codeStructure: 'SOC' });
      await insertCr(dataSource, {
        codeCr: 'CR_X',
        fkStructure: sId,
        dateDebutValidite: '2024-01-01',
      });

      await expect(
        service.update(
          'CR_X',
          { codeStructure: 'INEXISTANTE' },
          'admin@miznas.local',
        ),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('throws NotFoundException for unknown codeCr', async () => {
      await expect(
        service.update('UNKNOWN', { libelle: 'X' }, 'admin@miznas.local'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── relinkAfterStructureRevision

  describe('relinkAfterStructureRevision', () => {
    it('updates 1 CR pointing to old structure id', async () => {
      const oldId = await insertStructure(dataSource, { codeStructure: 'SOC' });
      await insertCr(dataSource, { codeCr: 'CR_X', fkStructure: oldId });
      const newId = await insertStructure(dataSource, {
        codeStructure: 'SOC2',
      });

      const result = await service.relinkAfterStructureRevision(
        oldId,
        newId,
        'admin@miznas.local',
      );
      expect(result.count).toBe(1);

      const cr = await service.findCurrent('CR_X');
      expect(String(cr?.fkStructure)).toBe(newId);
    });

    it('updates multiple CRs in a single call', async () => {
      const oldId = await insertStructure(dataSource, { codeStructure: 'SOC' });
      await insertCr(dataSource, { codeCr: 'CR_A', fkStructure: oldId });
      await insertCr(dataSource, { codeCr: 'CR_B', fkStructure: oldId });
      await insertCr(dataSource, { codeCr: 'CR_C', fkStructure: oldId });
      const newId = await insertStructure(dataSource, {
        codeStructure: 'SOC2',
      });

      const result = await service.relinkAfterStructureRevision(
        oldId,
        newId,
        'admin@miznas.local',
      );
      expect(result.count).toBe(3);
    });

    it('returns count=0 idempotently when no CR points to the old id', async () => {
      const oldId = await insertStructure(dataSource, { codeStructure: 'SOC' });
      const newId = await insertStructure(dataSource, {
        codeStructure: 'SOC2',
      });
      // Aucun CR
      const result = await service.relinkAfterStructureRevision(
        oldId,
        newId,
        'admin@miznas.local',
      );
      expect(result.count).toBe(0);
    });
  });
});
