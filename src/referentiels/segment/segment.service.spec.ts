/**
 * Tests unitaires SegmentService (SCD2 plat — pas de hiérarchie).
 *
 * Plus simple que les tests des dimensions hiérarchiques :
 * pas de findChildren / Descendants / Ancestors, pas de
 * validateNoCycle, pas de relink. Mais les 4-cas PATCH et
 * findByCategorie sont couverts.
 */
import { ConflictException, NotFoundException } from '@nestjs/common';
import { DataType, IMemoryDb, newDb } from 'pg-mem';
import { DataSource, Repository } from 'typeorm';

import { SegmentService } from './segment.service';
import {
  CategorieSegment,
  DimSegment,
} from './entities/dim-segment.entity';

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
    entities: [DimSegment],
    synchronize: true,
  });
  await ds.initialize();
  return ds;
}

async function rawInsert(
  ds: DataSource,
  attrs: {
    codeSegment: string;
    libelle?: string;
    categorie?: CategorieSegment;
    dateDebutValidite?: string;
    versionCourante?: boolean;
  },
): Promise<string> {
  const today = new Date().toISOString().slice(0, 10);
  await ds.query(
    `INSERT INTO dim_segment
       ("code_segment","libelle","categorie",
        "date_debut_validite","date_fin_validite",
        "version_courante","est_actif","utilisateur_creation")
     VALUES ($1,$2,$3,$4,NULL,$5,true,'system')`,
    [
      attrs.codeSegment,
      attrs.libelle ?? attrs.codeSegment,
      attrs.categorie ?? 'particulier',
      attrs.dateDebutValidite ?? today,
      attrs.versionCourante ?? true,
    ],
  );
  const rows = (await ds.query(
    `SELECT id FROM dim_segment WHERE code_segment = $1 AND version_courante = $2 ORDER BY id DESC LIMIT 1`,
    [attrs.codeSegment, attrs.versionCourante ?? true],
  )) as Array<{ id: string | number }>;
  return String(rows[0]!.id);
}

describe('SegmentService', () => {
  let dataSource: DataSource;
  let repo: Repository<DimSegment>;
  let service: SegmentService;

  beforeAll(async () => {
    dataSource = await createDataSource();
    repo = dataSource.getRepository(DimSegment);
    service = new SegmentService(repo, dataSource);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await dataSource.query('DELETE FROM dim_segment');
  });

  // ─── SCD2 hérité

  it('SCD2 hérité : findCurrent / findHistory', async () => {
    await rawInsert(dataSource, {
      codeSegment: 'PME',
      categorie: 'pme',
    });
    const current = await service.findCurrent('PME');
    expect(current?.codeSegment).toBe('PME');
    expect(await service.findHistory('PME')).toHaveLength(1);
  });

  // ─── findByCategorie

  describe('findByCategorie', () => {
    beforeEach(async () => {
      await rawInsert(dataSource, {
        codeSegment: 'PARTICULIER',
        categorie: 'particulier',
      });
      await rawInsert(dataSource, {
        codeSegment: 'PME',
        categorie: 'pme',
      });
      await rawInsert(dataSource, {
        codeSegment: 'GRANDE_ENTREPRISE',
        categorie: 'grande_entreprise',
      });
    });

    it('returns only segments of the requested category', async () => {
      const pme = await service.findByCategorie('pme');
      expect(pme.map((s) => s.codeSegment)).toEqual(['PME']);
    });

    it('returns empty list for unused category', async () => {
      const inst = await service.findByCategorie('institutionnel');
      expect(inst).toEqual([]);
    });
  });

  // ─── 4-cas PATCH

  describe('update (4-cas)', () => {
    beforeEach(async () => {
      await rawInsert(dataSource, {
        codeSegment: 'PME',
        libelle: 'PME',
        categorie: 'pme',
        dateDebutValidite: '2024-01-01',
      });
    });

    it('changing libelle on past version → nouvelle_version', async () => {
      const updated = await service.update(
        'PME',
        { libelle: 'PME (V2)' },
        'admin@miznas.local',
      );
      expect(updated.modeMaj).toBe('nouvelle_version');
      expect(await service.findHistory('PME')).toHaveLength(2);
    });

    it('changing categorie on past version → nouvelle_version', async () => {
      const updated = await service.update(
        'PME',
        { categorie: 'professionnel' },
        'admin@miznas.local',
      );
      expect(updated.modeMaj).toBe('nouvelle_version');
      expect(updated.categorie).toBe('professionnel');
    });

    it('changing libelle on TODAY version → ecrasement_intra_jour', async () => {
      await dataSource.query(`DELETE FROM dim_segment WHERE code_segment = 'PME'`);
      await rawInsert(dataSource, {
        codeSegment: 'PME',
        categorie: 'pme',
      });
      const updated = await service.update(
        'PME',
        { libelle: 'PME intra-jour' },
        'admin@miznas.local',
      );
      expect(updated.modeMaj).toBe('ecrasement_intra_jour');
      expect(await service.findHistory('PME')).toHaveLength(1);
    });

    it('changing only estActif → in_place_est_actif', async () => {
      const updated = await service.update(
        'PME',
        { estActif: false },
        'admin@miznas.local',
      );
      expect(updated.modeMaj).toBe('in_place_est_actif');
    });

    it('throws NotFoundException for unknown code', async () => {
      await expect(
        service.update('UNKNOWN', { libelle: 'X' }, 'tester'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── desactiver (pas de check enfants)

  describe('desactiver', () => {
    it('soft-closes any segment (no children check)', async () => {
      await rawInsert(dataSource, {
        codeSegment: 'PME',
        categorie: 'pme',
      });
      await service.desactiver('PME', 'admin@miznas.local');
      const history = await service.findHistory('PME');
      expect(history[0]!.versionCourante).toBe(false);
      expect(history[0]!.estActif).toBe(false);
    });

    it('throws NotFoundException for unknown code', async () => {
      await expect(
        service.desactiver('UNKNOWN', 'admin@miznas.local'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── create

  describe('create', () => {
    it('creates a new segment', async () => {
      const created = await service.create(
        { codeSegment: 'PME', libelle: 'PME', categorie: 'pme' },
        'admin@miznas.local',
      );
      expect(created.codeSegment).toBe('PME');
    });

    it('rejects duplicate codeSegment', async () => {
      await rawInsert(dataSource, {
        codeSegment: 'PME',
        categorie: 'pme',
      });
      await expect(
        service.create(
          { codeSegment: 'PME', libelle: 'Dup', categorie: 'pme' },
          'admin@miznas.local',
        ),
      ).rejects.toThrow(ConflictException);
    });
  });
});
