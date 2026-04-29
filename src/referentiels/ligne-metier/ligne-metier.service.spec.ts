/**
 * Tests unitaires LigneMetierService via pg-mem.
 * Pattern symétrique à compte.service.spec.ts (cf. notes pg-mem
 * partagées : bigint en number → coerce avec String() ; FK
 * auto-référente NULL avant DELETE).
 */
import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DataType, IMemoryDb, newDb } from 'pg-mem';
import { DataSource, Repository } from 'typeorm';

import { LigneMetierService } from './ligne-metier.service';
import { DimLigneMetier } from './entities/dim-ligne-metier.entity';

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
    entities: [DimLigneMetier],
    synchronize: true,
  });
  await ds.initialize();
  return ds;
}

async function rawInsert(
  ds: DataSource,
  attrs: {
    codeLigneMetier: string;
    libelle?: string;
    niveau?: number;
    parentId?: string | null;
    versionCourante?: boolean;
    estActif?: boolean;
    dateDebutValidite?: string;
    dateFinValidite?: string | null;
  },
): Promise<string> {
  const today = new Date().toISOString().slice(0, 10);
  await ds.query(
    `INSERT INTO dim_ligne_metier
       ("code_ligne_metier","libelle","fk_ligne_metier_parent","niveau",
        "date_debut_validite","date_fin_validite",
        "version_courante","est_actif","utilisateur_creation")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'system')`,
    [
      attrs.codeLigneMetier,
      attrs.libelle ?? attrs.codeLigneMetier,
      attrs.parentId ?? null,
      attrs.niveau ?? 1,
      attrs.dateDebutValidite ?? today,
      attrs.dateFinValidite ?? null,
      attrs.versionCourante ?? true,
      attrs.estActif ?? true,
    ],
  );
  const rows = (await ds.query(
    `SELECT id FROM dim_ligne_metier WHERE code_ligne_metier = $1 AND version_courante = $2 ORDER BY id DESC LIMIT 1`,
    [attrs.codeLigneMetier, attrs.versionCourante ?? true],
  )) as Array<{ id: string | number }>;
  return String(rows[0]!.id);
}

describe('LigneMetierService', () => {
  let dataSource: DataSource;
  let repo: Repository<DimLigneMetier>;
  let service: LigneMetierService;

  beforeAll(async () => {
    dataSource = await createDataSource();
    repo = dataSource.getRepository(DimLigneMetier);
    service = new LigneMetierService(repo, dataSource);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await dataSource.query(
      'UPDATE dim_ligne_metier SET fk_ligne_metier_parent = NULL',
    );
    await dataSource.query('DELETE FROM dim_ligne_metier');
  });

  // ─── SCD2 hérité — smoke

  it('SCD2 hérité : findCurrent / findHistory', async () => {
    await rawInsert(dataSource, { codeLigneMetier: 'RETAIL', niveau: 1 });
    const current = await service.findCurrent('RETAIL');
    expect(current?.codeLigneMetier).toBe('RETAIL');
    const history = await service.findHistory('RETAIL');
    expect(history).toHaveLength(1);
  });

  // ─── Hiérarchie

  describe('Hierarchy', () => {
    let idRetail: string;
    let idPart: string;
    let idPro: string;

    beforeEach(async () => {
      idRetail = await rawInsert(dataSource, {
        codeLigneMetier: 'RETAIL',
        niveau: 1,
      });
      idPart = await rawInsert(dataSource, {
        codeLigneMetier: 'RETAIL_PARTICULIERS',
        niveau: 2,
        parentId: idRetail,
      });
      idPro = await rawInsert(dataSource, {
        codeLigneMetier: 'RETAIL_PRO',
        niveau: 2,
        parentId: idRetail,
      });
    });

    it('findChildren returns direct children sorted', async () => {
      const children = await service.findChildren(idRetail);
      expect(children.map((c) => c.codeLigneMetier)).toEqual([
        'RETAIL_PARTICULIERS',
        'RETAIL_PRO',
      ]);
    });

    it('findDescendants walks the full subtree', async () => {
      const descendants = await service.findDescendants(idRetail);
      expect(descendants.map((c) => c.codeLigneMetier).sort()).toEqual([
        'RETAIL_PARTICULIERS',
        'RETAIL_PRO',
      ]);
    });

    it('findAncestors walks up to the root', async () => {
      const ancestors = await service.findAncestors(idPart);
      expect(ancestors.map((c) => c.codeLigneMetier)).toEqual(['RETAIL']);
    });

    it('findRoots returns parents-less current accounts', async () => {
      const roots = await service.findRoots();
      expect(roots.map((c) => c.codeLigneMetier)).toEqual(['RETAIL']);
    });

    it('idPro reachable via descendants regardless of insertion order', async () => {
      const descendants = await service.findDescendants(idRetail);
      expect(descendants.some((d) => String(d.id) === idPro)).toBe(true);
    });
  });

  // ─── validateNoCycle

  describe('validateNoCycle', () => {
    it('rejects self-cycle', async () => {
      const id = await rawInsert(dataSource, {
        codeLigneMetier: 'RETAIL',
        niveau: 1,
      });
      await expect(service.validateNoCycle(id, id)).rejects.toThrow(
        UnprocessableEntityException,
      );
    });

    it('rejects descendant-as-parent cycle', async () => {
      const idP = await rawInsert(dataSource, {
        codeLigneMetier: 'RETAIL',
        niveau: 1,
      });
      const idC = await rawInsert(dataSource, {
        codeLigneMetier: 'RETAIL_PARTICULIERS',
        niveau: 2,
        parentId: idP,
      });
      await expect(service.validateNoCycle(idP, idC)).rejects.toThrow(
        /Cycle hiérarchique/,
      );
    });
  });

  // ─── createNewVersionLigneMetier validations

  describe('createNewVersionLigneMetier (validations)', () => {
    it('rejects when parent does not exist', async () => {
      await expect(
        service.createNewVersionLigneMetier(
          'X',
          {
            libelle: 'X',
            niveau: 2,
            fkLigneMetierParent: '999999',
          } as Partial<DimLigneMetier>,
          'tester',
        ),
      ).rejects.toThrow(/introuvable/);
    });

    it('rejects when child niveau != parent niveau + 1', async () => {
      const idP = await rawInsert(dataSource, {
        codeLigneMetier: 'RETAIL',
        niveau: 1,
      });
      await expect(
        service.createNewVersionLigneMetier(
          'X',
          {
            libelle: 'X',
            niveau: 4,
            fkLigneMetierParent: idP,
          } as Partial<DimLigneMetier>,
          'tester',
        ),
      ).rejects.toThrow(/Incohérence niveau/);
    });
  });

  // ─── Smart update (4-cas)

  describe('update (4-cas)', () => {
    let idP: string;

    beforeEach(async () => {
      idP = await rawInsert(dataSource, {
        codeLigneMetier: 'RETAIL',
        niveau: 1,
        dateDebutValidite: '2024-01-01',
      });
      await rawInsert(dataSource, {
        codeLigneMetier: 'RETAIL_PARTICULIERS',
        niveau: 2,
        parentId: idP,
        dateDebutValidite: '2024-01-01',
      });
    });

    it('changing libelle on a past version → modeMaj=nouvelle_version', async () => {
      const updated = await service.update(
        'RETAIL_PARTICULIERS',
        { libelle: 'Particuliers (renommé)' },
        'admin@miznas.local',
      );
      expect(updated.modeMaj).toBe('nouvelle_version');
      const history = await service.findHistory('RETAIL_PARTICULIERS');
      expect(history).toHaveLength(2);
    });

    it('changing libelle on TODAY version → modeMaj=ecrasement_intra_jour', async () => {
      await dataSource.query(
        "DELETE FROM dim_ligne_metier WHERE code_ligne_metier = 'RETAIL_PARTICULIERS'",
      );
      await rawInsert(dataSource, {
        codeLigneMetier: 'RETAIL_PARTICULIERS',
        niveau: 2,
        parentId: idP,
        // dateDebutValidite défaut = today
      });

      const updated = await service.update(
        'RETAIL_PARTICULIERS',
        { libelle: 'Particuliers (intra-jour)' },
        'admin@miznas.local',
      );
      expect(updated.modeMaj).toBe('ecrasement_intra_jour');
      const history = await service.findHistory('RETAIL_PARTICULIERS');
      expect(history).toHaveLength(1);
    });

    it('changing only estActif → modeMaj=in_place_est_actif', async () => {
      const updated = await service.update(
        'RETAIL_PARTICULIERS',
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

  // ─── relink auto-référence

  describe('relinkAfterLigneMetierRevision', () => {
    it('updates 1 enfant pointing to old parent id', async () => {
      const oldP = await rawInsert(dataSource, {
        codeLigneMetier: 'RETAIL',
        niveau: 1,
      });
      await rawInsert(dataSource, {
        codeLigneMetier: 'RETAIL_PARTICULIERS',
        niveau: 2,
        parentId: oldP,
      });
      const newP = await rawInsert(dataSource, {
        codeLigneMetier: 'RETAIL_NEW',
        niveau: 1,
      });

      const result = await service.relinkAfterLigneMetierRevision(
        oldP,
        newP,
        'admin@miznas.local',
      );
      expect(result.count).toBe(1);
      const child = await service.findCurrent('RETAIL_PARTICULIERS');
      expect(String(child!.fkLigneMetierParent)).toBe(newP);
    });

    it('returns count=0 when no child points to the old id', async () => {
      const oldP = await rawInsert(dataSource, {
        codeLigneMetier: 'RETAIL',
        niveau: 1,
      });
      const newP = await rawInsert(dataSource, {
        codeLigneMetier: 'RETAIL_NEW',
        niveau: 1,
      });
      const result = await service.relinkAfterLigneMetierRevision(
        oldP,
        newP,
        'tester',
      );
      expect(result.count).toBe(0);
    });
  });

  // ─── desactiver

  describe('desactiver', () => {
    it('refuses when the ligne métier has current children', async () => {
      const idP = await rawInsert(dataSource, {
        codeLigneMetier: 'RETAIL',
        niveau: 1,
      });
      await rawInsert(dataSource, {
        codeLigneMetier: 'RETAIL_PARTICULIERS',
        niveau: 2,
        parentId: idP,
      });
      await expect(
        service.desactiver('RETAIL', 'admin@miznas.local'),
      ).rejects.toThrow(ConflictException);
    });

    it('soft-closes a leaf', async () => {
      await rawInsert(dataSource, {
        codeLigneMetier: 'RETAIL',
        niveau: 1,
      });
      await service.desactiver('RETAIL', 'admin@miznas.local');
      const history = await service.findHistory('RETAIL');
      expect(history[0]!.versionCourante).toBe(false);
      expect(history[0]!.estActif).toBe(false);
    });
  });

  // ─── create

  describe('create', () => {
    it('creates a new root (niveau 1, no parent)', async () => {
      const created = await service.create(
        { codeLigneMetier: 'RETAIL', libelle: 'Banque de détail', niveau: 1 },
        'admin@miznas.local',
      );
      expect(created.codeLigneMetier).toBe('RETAIL');
    });

    it('rejects creating a root with niveau != 1', async () => {
      await expect(
        service.create(
          { codeLigneMetier: 'RETAIL', libelle: 'X', niveau: 2 },
          'admin@miznas.local',
        ),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('rejects duplicate codeLigneMetier', async () => {
      await rawInsert(dataSource, {
        codeLigneMetier: 'RETAIL',
        niveau: 1,
      });
      await expect(
        service.create(
          { codeLigneMetier: 'RETAIL', libelle: 'Dup', niveau: 1 },
          'admin@miznas.local',
        ),
      ).rejects.toThrow(ConflictException);
    });
  });
});
