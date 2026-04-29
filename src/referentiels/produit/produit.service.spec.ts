/**
 * Tests unitaires ProduitService — symétriques à ligne-metier et compte.
 * pg-mem (bigint→number, FK auto-référente NULL avant DELETE).
 */
import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DataType, IMemoryDb, newDb } from 'pg-mem';
import { DataSource, Repository } from 'typeorm';

import { ProduitService } from './produit.service';
import { DimProduit, TypeProduit } from './entities/dim-produit.entity';

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
    entities: [DimProduit],
    synchronize: true,
  });
  await ds.initialize();
  return ds;
}

async function rawInsert(
  ds: DataSource,
  attrs: {
    codeProduit: string;
    libelle?: string;
    typeProduit?: TypeProduit;
    niveau?: number;
    parentId?: string | null;
    estPorteurInterets?: boolean;
    versionCourante?: boolean;
    estActif?: boolean;
    dateDebutValidite?: string;
  },
): Promise<string> {
  const today = new Date().toISOString().slice(0, 10);
  await ds.query(
    `INSERT INTO dim_produit
       ("code_produit","libelle","type_produit","fk_produit_parent","niveau",
        "est_porteur_interets","date_debut_validite","date_fin_validite",
        "version_courante","est_actif","utilisateur_creation")
     VALUES ($1,$2,$3,$4,$5,$6,$7,NULL,$8,$9,'system')`,
    [
      attrs.codeProduit,
      attrs.libelle ?? attrs.codeProduit,
      attrs.typeProduit ?? 'credit',
      attrs.parentId ?? null,
      attrs.niveau ?? 1,
      attrs.estPorteurInterets ?? false,
      attrs.dateDebutValidite ?? today,
      attrs.versionCourante ?? true,
      attrs.estActif ?? true,
    ],
  );
  const rows = (await ds.query(
    `SELECT id FROM dim_produit WHERE code_produit = $1 AND version_courante = $2 ORDER BY id DESC LIMIT 1`,
    [attrs.codeProduit, attrs.versionCourante ?? true],
  )) as Array<{ id: string | number }>;
  return String(rows[0]!.id);
}

describe('ProduitService', () => {
  let dataSource: DataSource;
  let repo: Repository<DimProduit>;
  let service: ProduitService;

  beforeAll(async () => {
    dataSource = await createDataSource();
    repo = dataSource.getRepository(DimProduit);
    service = new ProduitService(repo, dataSource);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await dataSource.query('UPDATE dim_produit SET fk_produit_parent = NULL');
    await dataSource.query('DELETE FROM dim_produit');
  });

  it('SCD2 hérité : findCurrent / findHistory', async () => {
    await rawInsert(dataSource, { codeProduit: 'CREDIT_GRP', niveau: 1 });
    const current = await service.findCurrent('CREDIT_GRP');
    expect(current?.codeProduit).toBe('CREDIT_GRP');
    expect(await service.findHistory('CREDIT_GRP')).toHaveLength(1);
  });

  describe('Hierarchy & filters', () => {
    let idCredit: string;
    let idTreso: string;

    beforeEach(async () => {
      idCredit = await rawInsert(dataSource, {
        codeProduit: 'CREDIT_GRP',
        typeProduit: 'credit',
        niveau: 1,
      });
      idTreso = await rawInsert(dataSource, {
        codeProduit: 'CREDIT_TRESORERIE',
        typeProduit: 'credit',
        niveau: 2,
        parentId: idCredit,
      });
      await rawInsert(dataSource, {
        codeProduit: 'CREDIT_DECOUVERT',
        typeProduit: 'credit',
        niveau: 3,
        parentId: idTreso,
        estPorteurInterets: true,
      });
      await rawInsert(dataSource, {
        codeProduit: 'DEPOT_GRP',
        typeProduit: 'depot',
        niveau: 1,
      });
    });

    it('findChildren returns direct children', async () => {
      const children = await service.findChildren(idCredit);
      expect(children.map((c) => c.codeProduit)).toEqual(['CREDIT_TRESORERIE']);
    });

    it('findDescendants walks the full subtree', async () => {
      const descendants = await service.findDescendants(idCredit);
      expect(descendants.map((c) => c.codeProduit).sort()).toEqual([
        'CREDIT_DECOUVERT',
        'CREDIT_TRESORERIE',
      ]);
    });

    it('findRoots returns roots only', async () => {
      const roots = await service.findRoots();
      expect(roots.map((r) => r.codeProduit).sort()).toEqual([
        'CREDIT_GRP',
        'DEPOT_GRP',
      ]);
    });

    it('findByType filters by typeProduit', async () => {
      const credits = await service.findByType('credit');
      expect(credits.map((c) => c.codeProduit).sort()).toEqual([
        'CREDIT_DECOUVERT',
        'CREDIT_GRP',
        'CREDIT_TRESORERIE',
      ]);
    });
  });

  describe('validateNoCycle', () => {
    it('rejects self-cycle', async () => {
      const id = await rawInsert(dataSource, {
        codeProduit: 'CREDIT_GRP',
        niveau: 1,
      });
      await expect(service.validateNoCycle(id, id)).rejects.toThrow(
        UnprocessableEntityException,
      );
    });

    it('rejects descendant-as-parent cycle', async () => {
      const idP = await rawInsert(dataSource, {
        codeProduit: 'CREDIT_GRP',
        niveau: 1,
      });
      const idC = await rawInsert(dataSource, {
        codeProduit: 'CREDIT_TRESORERIE',
        niveau: 2,
        parentId: idP,
      });
      await expect(service.validateNoCycle(idP, idC)).rejects.toThrow(
        /Cycle hiérarchique/,
      );
    });
  });

  describe('createNewVersionProduit (validations)', () => {
    it('rejects when parent does not exist', async () => {
      await expect(
        service.createNewVersionProduit(
          'X',
          {
            libelle: 'X',
            typeProduit: 'credit',
            niveau: 2,
            fkProduitParent: '999999',
          } as Partial<DimProduit>,
          'tester',
        ),
      ).rejects.toThrow(/introuvable/);
    });

    it('rejects when child niveau != parent niveau + 1', async () => {
      const idP = await rawInsert(dataSource, {
        codeProduit: 'CREDIT_GRP',
        niveau: 1,
      });
      await expect(
        service.createNewVersionProduit(
          'X',
          {
            libelle: 'X',
            typeProduit: 'credit',
            niveau: 4,
            fkProduitParent: idP,
          } as Partial<DimProduit>,
          'tester',
        ),
      ).rejects.toThrow(/Incohérence niveau/);
    });
  });

  describe('update (4-cas)', () => {
    let idP: string;

    beforeEach(async () => {
      idP = await rawInsert(dataSource, {
        codeProduit: 'CREDIT_GRP',
        niveau: 1,
        dateDebutValidite: '2024-01-01',
      });
      await rawInsert(dataSource, {
        codeProduit: 'CREDIT_TRESORERIE',
        niveau: 2,
        parentId: idP,
        dateDebutValidite: '2024-01-01',
      });
    });

    it('changing libelle on a past version → modeMaj=nouvelle_version', async () => {
      const updated = await service.update(
        'CREDIT_TRESORERIE',
        { libelle: 'Crédits trésorerie (V2)' },
        'admin@miznas.local',
      );
      expect(updated.modeMaj).toBe('nouvelle_version');
      expect(await service.findHistory('CREDIT_TRESORERIE')).toHaveLength(2);
    });

    it('changing estPorteurInterets on past version → nouvelle_version', async () => {
      const updated = await service.update(
        'CREDIT_TRESORERIE',
        { estPorteurInterets: true },
        'admin@miznas.local',
      );
      expect(updated.modeMaj).toBe('nouvelle_version');
    });

    it('changing libelle on TODAY version → ecrasement_intra_jour', async () => {
      await dataSource.query(
        "DELETE FROM dim_produit WHERE code_produit = 'CREDIT_TRESORERIE'",
      );
      await rawInsert(dataSource, {
        codeProduit: 'CREDIT_TRESORERIE',
        niveau: 2,
        parentId: idP,
      });

      const updated = await service.update(
        'CREDIT_TRESORERIE',
        { libelle: 'Intra-jour' },
        'admin@miznas.local',
      );
      expect(updated.modeMaj).toBe('ecrasement_intra_jour');
      expect(await service.findHistory('CREDIT_TRESORERIE')).toHaveLength(1);
    });

    it('changing only estActif → in_place_est_actif', async () => {
      const updated = await service.update(
        'CREDIT_TRESORERIE',
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

  describe('relinkAfterProduitRevision', () => {
    it('updates 1 enfant pointing to old parent id', async () => {
      const oldP = await rawInsert(dataSource, {
        codeProduit: 'CREDIT_GRP',
        niveau: 1,
      });
      await rawInsert(dataSource, {
        codeProduit: 'CREDIT_TRESORERIE',
        niveau: 2,
        parentId: oldP,
      });
      const newP = await rawInsert(dataSource, {
        codeProduit: 'CREDIT_GRP_NEW',
        niveau: 1,
      });
      const result = await service.relinkAfterProduitRevision(
        oldP,
        newP,
        'admin',
      );
      expect(result.count).toBe(1);
      const child = await service.findCurrent('CREDIT_TRESORERIE');
      expect(String(child!.fkProduitParent)).toBe(newP);
    });
  });

  describe('desactiver', () => {
    it('refuses when produit has current children', async () => {
      const idP = await rawInsert(dataSource, {
        codeProduit: 'CREDIT_GRP',
        niveau: 1,
      });
      await rawInsert(dataSource, {
        codeProduit: 'CREDIT_TRESORERIE',
        niveau: 2,
        parentId: idP,
      });
      await expect(
        service.desactiver('CREDIT_GRP', 'admin@miznas.local'),
      ).rejects.toThrow(ConflictException);
    });

    it('soft-closes a leaf', async () => {
      await rawInsert(dataSource, {
        codeProduit: 'CREDIT_GRP',
        niveau: 1,
      });
      await service.desactiver('CREDIT_GRP', 'admin@miznas.local');
      const history = await service.findHistory('CREDIT_GRP');
      expect(history[0]!.versionCourante).toBe(false);
      expect(history[0]!.estActif).toBe(false);
    });
  });

  describe('create', () => {
    it('creates a root with niveau 1', async () => {
      const created = await service.create(
        {
          codeProduit: 'CREDIT_GRP',
          libelle: 'Crédits',
          typeProduit: 'credit',
          niveau: 1,
        },
        'admin@miznas.local',
      );
      expect(created.codeProduit).toBe('CREDIT_GRP');
    });

    it('rejects root with niveau != 1', async () => {
      await expect(
        service.create(
          {
            codeProduit: 'X',
            libelle: 'X',
            typeProduit: 'credit',
            niveau: 2,
          },
          'admin@miznas.local',
        ),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('rejects duplicate codeProduit', async () => {
      await rawInsert(dataSource, {
        codeProduit: 'CREDIT_GRP',
        niveau: 1,
      });
      await expect(
        service.create(
          {
            codeProduit: 'CREDIT_GRP',
            libelle: 'Dup',
            typeProduit: 'credit',
            niveau: 1,
          },
          'admin@miznas.local',
        ),
      ).rejects.toThrow(ConflictException);
    });
  });
});
