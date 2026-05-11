/**
 * Tests Scd2Service via pg-mem (PostgreSQL en mémoire pur JS).
 *
 * Choix pg-mem (vs SQLite) : Scd2Service utilise des fonctionnalités
 * Postgres (`CURRENT_TIMESTAMP` en update, type `date`, queryBuilder
 * Postgres). SQLite ne reproduit pas ces sémantiques fidèlement.
 *
 * Limitations pg-mem contournées dans ces tests :
 *  - `GENERATED ALWAYS AS IDENTITY` n'est pas supporté par pg-mem 3.x.
 *    L'entité de test `DimTest` utilise `@PrimaryGeneratedColumn()`
 *    (serial classique) qui suffit à valider la logique métier SCD2.
 *    La contrainte `GENERATED ALWAYS` reste à valider en intégration
 *    Postgres réelle (Lot 6).
 *  - `current_database()` et `version()` doivent être enregistrées
 *    manuellement (TypeORM les appelle au boot du DataSource).
 */
import {
  Column,
  DataSource,
  Entity,
  PrimaryGeneratedColumn,
  Repository,
} from 'typeorm';
import { DataType, IMemoryDb, newDb } from 'pg-mem';

import { Scd2Entity } from '../entities/scd2.entity';
import { Scd2Service } from './scd2.service';

@Entity({ name: 'dim_test' })
class DimTest extends Scd2Entity {
  @PrimaryGeneratedColumn({ type: 'int' })
  id!: number;

  @Column({ name: 'code_test', type: 'varchar', length: 50 })
  codeTest!: string;

  @Column({ name: 'libelle', type: 'varchar', length: 150 })
  libelle!: string;
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
  const ds: DataSource = db.adapters.createTypeormDataSource({
    type: 'postgres',
    entities: [DimTest],
    synchronize: true,
  });
  await ds.initialize();
  return ds;
}

async function seed(
  repo: Repository<DimTest>,
  partial: Partial<DimTest>,
): Promise<DimTest> {
  return repo.save(
    repo.create({
      codeTest: 'A',
      libelle: 'L',
      dateDebutValidite: '2025-01-01',
      dateFinValidite: null,
      versionCourante: true,
      estActif: true,
      utilisateurCreation: 'system',
      utilisateurModification: null,
      dateModification: null,
      ...partial,
    } as DimTest),
  );
}

describe('Scd2Service', () => {
  let dataSource: DataSource;
  let repo: Repository<DimTest>;
  let service: Scd2Service<DimTest>;

  beforeAll(async () => {
    dataSource = await createDataSource();
    repo = dataSource.getRepository(DimTest);
    service = new Scd2Service<DimTest>(repo, 'codeTest', dataSource);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await dataSource.query('DELETE FROM dim_test');
  });

  describe('findCurrent', () => {
    it('returns only the row with versionCourante=true', async () => {
      await seed(repo, {
        codeTest: 'A',
        libelle: 'old',
        dateDebutValidite: '2024-01-01',
        dateFinValidite: '2025-01-01',
        versionCourante: false,
      });
      await seed(repo, {
        codeTest: 'A',
        libelle: 'current',
        dateDebutValidite: '2025-01-01',
        versionCourante: true,
      });

      const current = await service.findCurrent('A');
      expect(current).not.toBeNull();
      expect(current!.libelle).toBe('current');
      expect(current!.versionCourante).toBe(true);
    });

    it('returns null when the business key does not exist', async () => {
      const result = await service.findCurrent('UNKNOWN');
      expect(result).toBeNull();
    });
  });

  describe('findValidAt', () => {
    it('returns the version valid at a given date (mid-interval)', async () => {
      await seed(repo, {
        codeTest: 'A',
        libelle: 'v1',
        dateDebutValidite: '2025-01-01',
        dateFinValidite: '2025-07-01',
        versionCourante: false,
      });
      await seed(repo, {
        codeTest: 'A',
        libelle: 'v2',
        dateDebutValidite: '2025-07-01',
        dateFinValidite: null,
        versionCourante: true,
      });

      const result = await service.findValidAt('A', new Date('2025-04-15'));
      expect(result).not.toBeNull();
      expect(result!.libelle).toBe('v1');
    });

    it('returns null when the date is before any version', async () => {
      await seed(repo, {
        codeTest: 'A',
        libelle: 'v1',
        dateDebutValidite: '2025-01-01',
        dateFinValidite: null,
        versionCourante: true,
      });

      const result = await service.findValidAt('A', new Date('2024-01-01'));
      expect(result).toBeNull();
    });
  });

  describe('resolveVersionAtDate', () => {
    it('cas nominal : version unique trouvée et id retourné', async () => {
      const seeded = await seed(repo, {
        codeTest: 'A',
        libelle: 'unique',
        dateDebutValidite: '2025-01-01',
        dateFinValidite: null,
        versionCourante: true,
      });

      const result = await service.resolveVersionAtDate(
        'A',
        new Date('2025-06-15'),
      );
      expect(result).not.toBeNull();
      expect(result!.id).toBe(String(seeded.id));
      expect(result!.version.libelle).toBe('unique');
    });

    it('cas multi-versions : retourne celle valide à la date (Option B)', async () => {
      const v1 = await seed(repo, {
        codeTest: 'A',
        libelle: 'v1-ancienne',
        dateDebutValidite: '2025-01-01',
        dateFinValidite: '2025-07-01',
        versionCourante: false,
      });
      const v2 = await seed(repo, {
        codeTest: 'A',
        libelle: 'v2-courante',
        dateDebutValidite: '2025-07-01',
        dateFinValidite: null,
        versionCourante: true,
      });

      // 2025-04-15 → V1 (entre les deux dates de la V1)
      const r1 = await service.resolveVersionAtDate('A', '2025-04-15');
      expect(r1!.id).toBe(String(v1.id));
      expect(r1!.version.libelle).toBe('v1-ancienne');

      // 2025-08-15 → V2 (la courante)
      const r2 = await service.resolveVersionAtDate('A', '2025-08-15');
      expect(r2!.id).toBe(String(v2.id));
      expect(r2!.version.libelle).toBe('v2-courante');
    });

    it('cas date trop ancienne (avant toute version) → null', async () => {
      await seed(repo, {
        codeTest: 'A',
        libelle: 'v1',
        dateDebutValidite: '2025-01-01',
        dateFinValidite: null,
        versionCourante: true,
      });
      const result = await service.resolveVersionAtDate('A', '2024-06-30');
      expect(result).toBeNull();
    });

    it('cas date trop récente après softClose → null (la version a une fin)', async () => {
      // Simule l'état post-softClose : dateFinValidite posée,
      // versionCourante=false, plus aucune ligne courante.
      await seed(repo, {
        codeTest: 'A',
        libelle: 'fermée',
        dateDebutValidite: '2025-01-01',
        dateFinValidite: '2025-12-31',
        versionCourante: false,
        estActif: false,
      });
      const result = await service.resolveVersionAtDate('A', '2026-06-15');
      expect(result).toBeNull();
    });

    it('cas date trop récente sans softClose → retourne la courante (fin nulle)', async () => {
      await seed(repo, {
        codeTest: 'A',
        libelle: 'courante',
        dateDebutValidite: '2025-01-01',
        dateFinValidite: null,
        versionCourante: true,
      });
      const result = await service.resolveVersionAtDate('A', '2099-12-31');
      expect(result).not.toBeNull();
      expect(result!.version.libelle).toBe('courante');
    });
  });

  describe('findHistory', () => {
    it('returns versions in ascending chronological order', async () => {
      await seed(repo, {
        codeTest: 'A',
        libelle: 'v3',
        dateDebutValidite: '2026-01-01',
        versionCourante: true,
      });
      await seed(repo, {
        codeTest: 'A',
        libelle: 'v1',
        dateDebutValidite: '2024-01-01',
        dateFinValidite: '2025-01-01',
        versionCourante: false,
      });
      await seed(repo, {
        codeTest: 'A',
        libelle: 'v2',
        dateDebutValidite: '2025-01-01',
        dateFinValidite: '2026-01-01',
        versionCourante: false,
      });

      const history = await service.findHistory('A');
      expect(history.map((v) => v.libelle)).toEqual(['v1', 'v2', 'v3']);
    });
  });

  describe('findAllCurrent', () => {
    it('returns only versionCourante=true rows (no extra filter)', async () => {
      await seed(repo, {
        codeTest: 'A',
        libelle: 'A-cur',
        versionCourante: true,
      });
      await seed(repo, {
        codeTest: 'A',
        libelle: 'A-old',
        versionCourante: false,
        dateDebutValidite: '2024-01-01',
        dateFinValidite: '2025-01-01',
      });
      await seed(repo, {
        codeTest: 'B',
        libelle: 'B-cur',
        versionCourante: true,
      });

      const all = await service.findAllCurrent();
      expect(all).toHaveLength(2);
      expect(all.map((v) => v.libelle).sort()).toEqual(['A-cur', 'B-cur']);
    });

    it('honours an extra filter combined with versionCourante', async () => {
      await seed(repo, {
        codeTest: 'A',
        libelle: 'A-cur',
        versionCourante: true,
        estActif: true,
      });
      await seed(repo, {
        codeTest: 'B',
        libelle: 'B-cur',
        versionCourante: true,
        estActif: false,
      });

      const actifs = await service.findAllCurrent({
        estActif: true,
      } as Partial<DimTest> as never);
      expect(actifs).toHaveLength(1);
      expect(actifs[0]!.libelle).toBe('A-cur');
    });
  });

  describe('createNewVersion', () => {
    it('closes the old version and inserts the new one in the same transaction', async () => {
      await seed(repo, {
        codeTest: 'A',
        libelle: 'old',
        dateDebutValidite: '2025-01-01',
        versionCourante: true,
      });

      const today = new Date().toISOString().slice(0, 10);
      const created = await service.createNewVersion(
        'A',
        { libelle: 'new' } as Partial<DimTest>,
        'tester',
      );

      expect(created.libelle).toBe('new');
      expect(created.versionCourante).toBe(true);
      expect(created.dateDebutValidite).toBe(today);
      expect(created.dateFinValidite).toBeNull();
      expect(created.utilisateurCreation).toBe('tester');

      const history = await service.findHistory('A');
      expect(history).toHaveLength(2);
      const old = history.find((v) => v.libelle === 'old')!;
      expect(old.versionCourante).toBe(false);
      expect(old.dateFinValidite).toBe(today);
      expect(old.utilisateurModification).toBe('tester');
    });

    it('respects the default estActif=true when attrs.estActif is not provided', async () => {
      const created = await service.createNewVersion(
        'A',
        { libelle: 'libellé' } as Partial<DimTest>,
        'tester',
      );
      expect(created.estActif).toBe(true);
    });

    /**
     * Test de non-régression du contrat « défauts override-ables »
     * (cf. refactor 2.3A.0 du socle : `estActif` placé AVANT le spread
     * `attrs` permet à l'appelant d'override le défaut). Cas d'usage :
     * PATCH SCD2 + désactivation atomique sur dim_structure (Lot 2.3A).
     */
    it('lets attrs.estActif=false override the application default', async () => {
      const created = await service.createNewVersion(
        'A',
        { libelle: 'libellé', estActif: false } as Partial<DimTest>,
        'tester',
      );
      expect(created.estActif).toBe(false);
    });

    /**
     * Verrou des invariants SCD2 : `versionCourante`, `dateDebutValidite`,
     * `dateFinValidite`, et la business key sont posés APRÈS le spread
     * de `attrs`. L'appelant ne peut donc pas les corrompre, même
     * accidentellement.
     */
    it('locks SCD2 invariants — attrs cannot override versionCourante / dateFinValidite', async () => {
      const today = new Date().toISOString().slice(0, 10);
      const created = await service.createNewVersion(
        'A',
        {
          libelle: 'tentative',
          versionCourante: false,
          dateFinValidite: '2020-01-01',
          dateDebutValidite: '1999-01-01',
        } as Partial<DimTest>,
        'tester',
      );
      expect(created.versionCourante).toBe(true);
      expect(created.dateFinValidite).toBeNull();
      expect(created.dateDebutValidite).toBe(today);
    });

    /**
     * Limitation pg-mem 3.x : l'adapter TypeORM ne propage pas
     * correctement le `ROLLBACK` quand le callback de
     * `dataSource.transaction(...)` rejette — l'UPDATE qui ferme
     * l'ancienne version reste committé même si l'INSERT suivant
     * échoue. On valide donc ici **l'intention transactionnelle**
     * (createNewVersion délègue bien à `dataSource.transaction`,
     * et l'erreur d'insertion est propagée au caller). La rollback
     * réelle sera vérifiée en test d'intégration Postgres en
     * Lot 6 (recette).
     */
    it('propagates insert errors and goes through dataSource.transaction', async () => {
      await seed(repo, {
        codeTest: 'A',
        libelle: 'old',
        dateDebutValidite: '2025-01-01',
        versionCourante: true,
      });

      const txSpy = jest.spyOn(dataSource, 'transaction');

      await expect(
        service.createNewVersion('A', {} as Partial<DimTest>, 'tester'),
      ).rejects.toThrow();

      expect(txSpy).toHaveBeenCalled();
      txSpy.mockRestore();
    });
  });

  describe('softClose', () => {
    it('closes the current version without creating a new one and sets estActif=false', async () => {
      await seed(repo, {
        codeTest: 'A',
        libelle: 'cur',
        dateDebutValidite: '2025-01-01',
        versionCourante: true,
        estActif: true,
      });

      await service.softClose('A', 'tester');

      const today = new Date().toISOString().slice(0, 10);
      const current = await service.findCurrent('A');
      expect(current).toBeNull();

      const all = await service.findHistory('A');
      expect(all).toHaveLength(1);
      expect(all[0]!.versionCourante).toBe(false);
      expect(all[0]!.estActif).toBe(false);
      expect(all[0]!.dateFinValidite).toBe(today);
      expect(all[0]!.utilisateurModification).toBe('tester');
    });
  });
});
