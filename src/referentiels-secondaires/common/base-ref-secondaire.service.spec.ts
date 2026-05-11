/**
 * Tests unitaires BaseRefSecondaireService via pg-mem.
 *
 * On utilise une entité concrète de test `RefTest` pour exercer le
 * service générique sans dépendre d'une migration. Les sous-classes
 * réelles seront testées via leurs e2e dédiés.
 */
import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DataType, IMemoryDb, newDb } from 'pg-mem';
import {
  DataSource,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Repository,
} from 'typeorm';

import { BaseRefSecondaireService } from './base-ref-secondaire.service';
import { BaseRefSecondaire } from './entities/base-ref-secondaire.entity';

@Entity({ name: 'ref_test' })
@Index('uq_ref_test_code', ['code'], { unique: true })
class RefTest extends BaseRefSecondaire {
  @PrimaryGeneratedColumn({ type: 'int' })
  id!: string;
}

class RefTestService extends BaseRefSecondaireService<RefTest> {
  public referencedCodes = new Set<string>();
  override async isReferenced(code: string): Promise<boolean> {
    return this.referencedCodes.has(code);
  }
  protected override get consumerLabel(): string {
    return 'par dim_test';
  }
}

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
    entities: [RefTest],
    synchronize: true,
  });
  await ds.initialize();
  return ds;
}

async function seed(
  repo: Repository<RefTest>,
  partial: Partial<RefTest>,
): Promise<RefTest> {
  return repo.save(
    repo.create({
      code: 'X',
      libelle: 'X',
      description: null,
      ordre: 0,
      estActif: true,
      estSysteme: false,
      utilisateurCreation: 'system',
      ...partial,
    } as RefTest),
  );
}

describe('BaseRefSecondaireService', () => {
  let dataSource: DataSource;
  let repo: Repository<RefTest>;
  let service: RefTestService;

  beforeAll(async () => {
    dataSource = await createDataSource();
    repo = dataSource.getRepository(RefTest);
    service = new RefTestService(repo);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await dataSource.query('DELETE FROM ref_test');
    service.referencedCodes.clear();
  });

  // ─── Lecture

  describe('findAll', () => {
    it('retourne items + total triés par ordre ASC puis code ASC', async () => {
      await seed(repo, { code: 'b', libelle: 'B', ordre: 20 });
      await seed(repo, { code: 'a', libelle: 'A', ordre: 10 });
      await seed(repo, { code: 'c', libelle: 'C', ordre: 10 });
      const r = await service.findAll({ page: 1, limit: 50 });
      expect(r.total).toBe(3);
      expect(r.items.map((i) => i.code)).toEqual(['a', 'c', 'b']);
    });

    it('filtre estActif=true', async () => {
      await seed(repo, { code: 'a', estActif: true });
      await seed(repo, { code: 'b', estActif: false });
      const r = await service.findAll({ page: 1, limit: 50, estActif: true });
      expect(r.items.map((i) => i.code)).toEqual(['a']);
    });

    it('filtre estSysteme=true', async () => {
      await seed(repo, { code: 'sys', estSysteme: true });
      await seed(repo, { code: 'cust', estSysteme: false });
      const r = await service.findAll({
        page: 1,
        limit: 50,
        estSysteme: true,
      });
      expect(r.items.map((i) => i.code)).toEqual(['sys']);
    });

    it('search ILIKE %libelle%', async () => {
      await seed(repo, { code: 'a', libelle: 'Salaires bruts' });
      await seed(repo, { code: 'b', libelle: 'Charges externes' });
      const r = await service.findAll({
        page: 1,
        limit: 50,
        search: 'salaire',
      });
      expect(r.items).toHaveLength(1);
      expect(r.items[0]!.libelle).toBe('Salaires bruts');
    });
  });

  describe('findByCode / findById', () => {
    it('findByCode retourne la ligne', async () => {
      await seed(repo, { code: 'agence' });
      const found = await service.findByCode('agence');
      expect(found.code).toBe('agence');
    });

    it('findByCode lance NotFoundException', async () => {
      await expect(service.findByCode('inconnu')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('findById lance NotFoundException', async () => {
      await expect(service.findById('99999')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ─── Création

  describe('create', () => {
    it('crée une nouvelle valeur (estSysteme=false par défaut)', async () => {
      const r = await service.create(
        {
          code: 'succursale',
          libelle: 'Succursale',
          description: 'Point de vente sans personnel.',
          ordre: 60,
        },
        'admin@miznas.local',
      );
      expect(r.code).toBe('succursale');
      expect(r.estSysteme).toBe(false); // jamais possible via API
      expect(r.estActif).toBe(true);
      expect(r.utilisateurCreation).toBe('admin@miznas.local');
    });

    it('refuse un code dupliqué → 409', async () => {
      await seed(repo, { code: 'agence' });
      await expect(
        service.create({ code: 'agence', libelle: 'Agence' }, 'admin'),
      ).rejects.toThrow(ConflictException);
    });
  });

  // ─── Mise à jour

  describe('update', () => {
    it('modifie libellé / description / ordre / estActif', async () => {
      const seeded = await seed(repo, { code: 'a', libelle: 'old' });
      const r = await service.update(
        String(seeded.id),
        {
          libelle: 'new',
          description: 'desc',
          ordre: 100,
          estActif: false,
        },
        'admin',
      );
      expect(r.libelle).toBe('new');
      expect(r.description).toBe('desc');
      expect(r.ordre).toBe(100);
      expect(r.estActif).toBe(false);
      expect(r.utilisateurModification).toBe('admin');
    });

    it('refuse de renommer le code si estSysteme=true → 422', async () => {
      const seeded = await seed(repo, {
        code: 'CREATE',
        estSysteme: true,
      });
      await expect(
        service.update(String(seeded.id), { code: 'CREATED' }, 'admin'),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('autorise renommer code sur valeur custom (estSysteme=false)', async () => {
      const seeded = await seed(repo, {
        code: 'foo',
        estSysteme: false,
      });
      const r = await service.update(
        String(seeded.id),
        { code: 'bar' },
        'admin',
      );
      expect(r.code).toBe('bar');
    });

    it('refuse renommer vers un code déjà pris → 409', async () => {
      const a = await seed(repo, { code: 'a' });
      await seed(repo, { code: 'b' });
      await expect(
        service.update(String(a.id), { code: 'b' }, 'admin'),
      ).rejects.toThrow(ConflictException);
    });

    it('autorise update libellé même sur estSysteme=true', async () => {
      const seeded = await seed(repo, {
        code: 'CREATE',
        libelle: 'Création',
        estSysteme: true,
      });
      const r = await service.update(
        String(seeded.id),
        { libelle: 'Création (renommé)' },
        'admin',
      );
      expect(r.libelle).toBe('Création (renommé)');
    });
  });

  // ─── toggleActif

  describe('toggleActif', () => {
    it('passe à false sur valeur non-référencée → pas de warning', async () => {
      const seeded = await seed(repo, { code: 'a', estActif: true });
      const r = await service.toggleActif(String(seeded.id), 'admin');
      expect(r.entity.estActif).toBe(false);
      expect(r.warning).toBeNull();
    });

    it('passe à false sur valeur référencée → warning explicite', async () => {
      const seeded = await seed(repo, { code: 'agence', estActif: true });
      service.referencedCodes.add('agence');
      const r = await service.toggleActif(String(seeded.id), 'admin');
      expect(r.entity.estActif).toBe(false);
      expect(r.warning).toMatch(/agence.*par dim_test/);
    });

    it('passe à true (réactivation) → pas de warning', async () => {
      const seeded = await seed(repo, { code: 'a', estActif: false });
      service.referencedCodes.add('a'); // même référencée, pas de warning à l'activation
      const r = await service.toggleActif(String(seeded.id), 'admin');
      expect(r.entity.estActif).toBe(true);
      expect(r.warning).toBeNull();
    });
  });

  // ─── Soft-delete

  describe('softDelete', () => {
    it('refuse si estSysteme=true → 409', async () => {
      const seeded = await seed(repo, {
        code: 'CREATE',
        estSysteme: true,
      });
      await expect(
        service.softDelete(String(seeded.id), 'admin'),
      ).rejects.toThrow(ConflictException);
    });

    it('refuse si valeur référencée par une dimension → 409', async () => {
      const seeded = await seed(repo, {
        code: 'agence',
        estSysteme: false,
      });
      service.referencedCodes.add('agence');
      await expect(
        service.softDelete(String(seeded.id), 'admin'),
      ).rejects.toThrow(ConflictException);
    });

    it('supprime physiquement si non-systeme et non-référencée', async () => {
      const seeded = await seed(repo, {
        code: 'succursale',
        estSysteme: false,
      });
      await service.softDelete(String(seeded.id), 'admin');
      expect(await repo.count()).toBe(0);
    });
  });
});
