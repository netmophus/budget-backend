/**
 * Tests unitaires DeviseService via pg-mem.
 *
 * Limitation pg-mem documentée :
 *  - L'index unique partiel `uq_dim_devise_pivot` n'est PAS créé par
 *    `synchronize:true` (TypeORM ne sait pas le générer depuis le
 *    metadata). En pg-mem, l'invariant pivot unique est donc protégé
 *    UNIQUEMENT par les checks du service (`ConflictException`). En
 *    Postgres réel, l'index partiel apporte une 2ᵉ ligne de défense
 *    contre les race conditions ; cette ligne est testée en intégration
 *    Postgres au Lot 6.
 */
import {
  ConflictException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { DataType, IMemoryDb, newDb } from 'pg-mem';
import { DataSource, Repository } from 'typeorm';

import { DeviseService } from './devise.service';
import { DimDevise } from './entities/dim-devise.entity';

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
    entities: [DimDevise],
    synchronize: true,
  });
  await ds.initialize();
  return ds;
}

async function insertDevise(
  repo: Repository<DimDevise>,
  partial: Partial<DimDevise>,
): Promise<DimDevise> {
  return repo.save(
    repo.create({
      codeIso: 'XOF',
      libelle: 'Franc CFA BCEAO',
      symbole: 'F CFA',
      nbDecimales: 0,
      estDevisePivot: true,
      estActive: true,
      utilisateurCreation: 'system',
      utilisateurModification: null,
      dateModification: null,
      ...partial,
    } as DimDevise),
  );
}

describe('DeviseService', () => {
  let dataSource: DataSource;
  let repo: Repository<DimDevise>;
  let service: DeviseService;

  beforeAll(async () => {
    dataSource = await createDataSource();
    repo = dataSource.getRepository(DimDevise);
    service = new DeviseService(repo);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await dataSource.query('DELETE FROM dim_devise');
  });

  describe('findOne', () => {
    it('returns the row by id', async () => {
      const xof = await insertDevise(repo, {});
      const result = await service.findOne(xof.id);
      expect(result.codeIso).toBe('XOF');
    });

    it('throws NotFoundException when missing', async () => {
      await expect(service.findOne('999999')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findByCodeIso', () => {
    it('returns the row by ISO code', async () => {
      await insertDevise(repo, {});
      const result = await service.findByCodeIso('XOF');
      expect(result?.codeIso).toBe('XOF');
    });

    it('normalises case (xof → XOF)', async () => {
      await insertDevise(repo, {});
      const result = await service.findByCodeIso('xof');
      expect(result?.codeIso).toBe('XOF');
    });

    it('returns null when not found', async () => {
      const result = await service.findByCodeIso('ZZZ');
      expect(result).toBeNull();
    });
  });

  describe('findPivot', () => {
    it('returns XOF when pivot is set', async () => {
      await insertDevise(repo, { codeIso: 'XOF', estDevisePivot: true });
      const result = await service.findPivot();
      expect(result.codeIso).toBe('XOF');
    });

    it('throws InternalServerErrorException when no pivot exists (invariant violated)', async () => {
      await insertDevise(repo, {
        codeIso: 'EUR',
        libelle: 'Euro',
        estDevisePivot: false,
      });
      await expect(service.findPivot()).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  describe('findAll', () => {
    it('orders by code_iso ASC', async () => {
      await insertDevise(repo, { codeIso: 'EUR', libelle: 'Euro', estDevisePivot: false });
      await insertDevise(repo, { codeIso: 'XOF', estDevisePivot: true });
      await insertDevise(repo, { codeIso: 'USD', libelle: 'Dollar', estDevisePivot: false });

      const result = await service.findAll({ page: 1, limit: 50 });
      expect(result.total).toBe(3);
      expect(result.items.map((d) => d.codeIso)).toEqual(['EUR', 'USD', 'XOF']);
    });

    it('paginates', async () => {
      for (const code of ['AAA', 'BBB', 'CCC', 'DDD']) {
        await insertDevise(repo, {
          codeIso: code,
          libelle: code,
          estDevisePivot: false,
        });
      }

      const page1 = await service.findAll({ page: 1, limit: 2 });
      expect(page1.items.map((d) => d.codeIso)).toEqual(['AAA', 'BBB']);
      const page2 = await service.findAll({ page: 2, limit: 2 });
      expect(page2.items.map((d) => d.codeIso)).toEqual(['CCC', 'DDD']);
    });

    it('filters by estActive', async () => {
      await insertDevise(repo, { codeIso: 'AAA', libelle: 'A', estActive: true, estDevisePivot: false });
      await insertDevise(repo, { codeIso: 'BBB', libelle: 'B', estActive: false, estDevisePivot: false });

      const actifs = await service.findAll({ page: 1, limit: 50, estActive: true });
      expect(actifs.total).toBe(1);
      expect(actifs.items[0]!.codeIso).toBe('AAA');
    });
  });

  describe('create', () => {
    it('creates a non-pivot devise', async () => {
      await insertDevise(repo, { codeIso: 'XOF', estDevisePivot: true });
      const created = await service.create(
        {
          codeIso: 'JPY',
          libelle: 'Yen japonais',
          symbole: '¥',
          nbDecimales: 2,
        },
        'admin@miznas.local',
      );
      expect(created.codeIso).toBe('JPY');
      expect(created.estDevisePivot).toBe(false);
      expect(created.utilisateurCreation).toBe('admin@miznas.local');
    });

    it('throws ConflictException when codeIso already exists', async () => {
      await insertDevise(repo, { codeIso: 'XOF', estDevisePivot: true });
      await expect(
        service.create(
          { codeIso: 'XOF', libelle: 'Duplicate' },
          'admin@miznas.local',
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('throws ConflictException when trying to create a second pivot', async () => {
      await insertDevise(repo, { codeIso: 'XOF', estDevisePivot: true });
      await expect(
        service.create(
          {
            codeIso: 'EUR',
            libelle: 'Euro',
            estDevisePivot: true,
          },
          'admin@miznas.local',
        ),
      ).rejects.toThrow(/Une devise pivot existe déjà/);
    });

    it('allows creating the very first pivot when no pivot exists', async () => {
      const created = await service.create(
        {
          codeIso: 'XOF',
          libelle: 'Franc CFA BCEAO',
          symbole: 'F CFA',
          nbDecimales: 0,
          estDevisePivot: true,
        },
        'admin@miznas.local',
      );
      expect(created.estDevisePivot).toBe(true);
    });
  });

  describe('update', () => {
    it('updates libelle on a non-pivot devise', async () => {
      await insertDevise(repo, { codeIso: 'XOF', estDevisePivot: true });
      const eur = await insertDevise(repo, {
        codeIso: 'EUR',
        libelle: 'Euro',
        estDevisePivot: false,
      });

      const updated = await service.update(
        eur.id,
        { libelle: 'Euro (zone UE)' },
        'admin@miznas.local',
      );
      expect(updated.libelle).toBe('Euro (zone UE)');
      expect(updated.utilisateurModification).toBe('admin@miznas.local');
    });

    it('refuses to deactivate the pivot devise', async () => {
      const xof = await insertDevise(repo, {
        codeIso: 'XOF',
        estDevisePivot: true,
      });
      await expect(
        service.update(xof.id, { estActive: false }, 'admin@miznas.local'),
      ).rejects.toThrow(/Impossible de désactiver la devise pivot/);
    });

    it('refuses to remove the pivot status without designating another', async () => {
      const xof = await insertDevise(repo, {
        codeIso: 'XOF',
        estDevisePivot: true,
      });
      await expect(
        service.update(xof.id, { estDevisePivot: false }, 'admin@miznas.local'),
      ).rejects.toThrow(/Impossible de retirer le statut pivot/);
    });

    it('refuses to promote a second devise to pivot', async () => {
      await insertDevise(repo, { codeIso: 'XOF', estDevisePivot: true });
      const eur = await insertDevise(repo, {
        codeIso: 'EUR',
        libelle: 'Euro',
        estDevisePivot: false,
      });

      await expect(
        service.update(eur.id, { estDevisePivot: true }, 'admin@miznas.local'),
      ).rejects.toThrow(/Une devise pivot existe déjà/);
    });

    it('throws NotFoundException when the id does not exist', async () => {
      await expect(
        service.update('999999', { libelle: 'X' }, 'admin@miznas.local'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('desactiver', () => {
    it('soft-deletes a non-pivot devise (estActive=false)', async () => {
      await insertDevise(repo, { codeIso: 'XOF', estDevisePivot: true });
      const eur = await insertDevise(repo, {
        codeIso: 'EUR',
        libelle: 'Euro',
        estDevisePivot: false,
      });

      const result = await service.desactiver(eur.id, 'admin@miznas.local');
      expect(result.estActive).toBe(false);
      expect(result.utilisateurModification).toBe('admin@miznas.local');
    });

    it('refuses to deactivate the pivot devise', async () => {
      const xof = await insertDevise(repo, {
        codeIso: 'XOF',
        estDevisePivot: true,
      });
      await expect(
        service.desactiver(xof.id, 'admin@miznas.local'),
      ).rejects.toThrow(ConflictException);
    });

    it('throws NotFoundException when the id does not exist', async () => {
      await expect(
        service.desactiver('999999', 'admin@miznas.local'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
