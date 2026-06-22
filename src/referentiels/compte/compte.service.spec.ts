/**
 * Tests unitaires CompteService via pg-mem.
 * Cf. notes pg-mem partagées (structure.service.spec.ts) :
 *  - bigint en number → coerce avec String() pour comparer
 *  - FK auto-référente : NULL avant DELETE
 */
import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DataType, IMemoryDb, newDb } from 'pg-mem';
import { DataSource, Repository } from 'typeorm';

import { CompteService } from './compte.service';
import { DimCompte } from './entities/dim-compte.entity';

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
    entities: [DimCompte],
    synchronize: true,
  });
  await ds.initialize();
  return ds;
}

async function rawInsert(
  ds: DataSource,
  attrs: {
    codeCompte: string;
    libelle?: string;
    classe?: string;
    niveau?: number;
    parentId?: string | null;
    sens?: string | null;
    estCompteCollectif?: boolean;
    estPorteurInterets?: boolean;
    versionCourante?: boolean;
    estActif?: boolean;
    dateDebutValidite?: string;
    dateFinValidite?: string | null;
    codePosteBudgetaire?: string | null;
  },
): Promise<string> {
  const today = new Date().toISOString().slice(0, 10);
  await ds.query(
    `INSERT INTO dim_compte
       ("code_compte","libelle","classe","sous_classe","fk_compte_parent",
        "niveau","sens","code_poste_budgetaire","est_compte_collectif",
        "est_porteur_interets","date_debut_validite","date_fin_validite",
        "version_courante","est_actif","utilisateur_creation")
     VALUES ($1,$2,$3,NULL,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'system')`,
    [
      attrs.codeCompte,
      attrs.libelle ?? attrs.codeCompte,
      attrs.classe ?? '6',
      attrs.parentId ?? null,
      attrs.niveau ?? 1,
      attrs.sens ?? null,
      attrs.codePosteBudgetaire ?? null,
      attrs.estCompteCollectif ?? false,
      attrs.estPorteurInterets ?? false,
      attrs.dateDebutValidite ?? today,
      attrs.dateFinValidite ?? null,
      attrs.versionCourante ?? true,
      attrs.estActif ?? true,
    ],
  );
  const rows = (await ds.query(
    `SELECT id FROM dim_compte WHERE code_compte = $1 AND version_courante = $2 ORDER BY id DESC LIMIT 1`,
    [attrs.codeCompte, attrs.versionCourante ?? true],
  )) as Array<{ id: string | number }>;
  return String(rows[0]!.id);
}

describe('CompteService', () => {
  let dataSource: DataSource;
  let repo: Repository<DimCompte>;
  let service: CompteService;

  beforeAll(async () => {
    dataSource = await createDataSource();
    repo = dataSource.getRepository(DimCompte);
    service = new CompteService(repo, dataSource);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await dataSource.query('UPDATE dim_compte SET fk_compte_parent = NULL');
    await dataSource.query('DELETE FROM dim_compte');
  });

  // ─── SCD2 hérité — smoke

  describe('SCD2 inherited (smoke)', () => {
    it('findCurrent / findHistory work', async () => {
      await rawInsert(dataSource, { codeCompte: '6', classe: '6', niveau: 1 });
      const current = await service.findCurrent('6');
      expect(current?.codeCompte).toBe('6');
      const history = await service.findHistory('6');
      expect(history).toHaveLength(1);
    });
  });

  // ─── Hiérarchie

  describe('Hierarchy', () => {
    let id6: string;
    let id60: string;
    let id601: string;
    let id601100: string;

    beforeEach(async () => {
      id6 = await rawInsert(dataSource, {
        codeCompte: '6',
        classe: '6',
        niveau: 1,
        sens: 'D',
      });
      id60 = await rawInsert(dataSource, {
        codeCompte: '60',
        classe: '6',
        niveau: 2,
        parentId: id6,
        sens: 'D',
      });
      id601 = await rawInsert(dataSource, {
        codeCompte: '601',
        classe: '6',
        niveau: 3,
        parentId: id60,
        sens: 'D',
      });
      id601100 = await rawInsert(dataSource, {
        codeCompte: '601100',
        classe: '6',
        niveau: 4,
        parentId: id601,
        sens: 'D',
      });
    });

    it('findChildren returns direct children', async () => {
      const children = await service.findChildren(id60);
      expect(children.map((c) => c.codeCompte)).toEqual(['601']);
    });

    it('findDescendants walks the full subtree', async () => {
      const descendants = await service.findDescendants(id6);
      expect(descendants.map((c) => c.codeCompte).sort()).toEqual([
        '60',
        '601',
        '601100',
      ]);
    });

    it('findAncestors walks up to the root', async () => {
      const ancestors = await service.findAncestors(id601100);
      expect(ancestors.map((c) => c.codeCompte)).toEqual(['601', '60', '6']);
    });

    it('findRoots returns parents-less current accounts', async () => {
      const roots = await service.findRoots();
      expect(roots.map((c) => c.codeCompte)).toEqual(['6']);
    });

    it('findByClasse filters by classe', async () => {
      await rawInsert(dataSource, {
        codeCompte: '7',
        classe: '7',
        niveau: 1,
        sens: 'C',
      });
      const c6 = await service.findByClasse('6');
      expect(c6.map((c) => c.codeCompte).sort()).toEqual([
        '6',
        '60',
        '601',
        '601100',
      ]);
    });
  });

  // ─── validateNoCycle

  describe('validateNoCycle', () => {
    it('rejects self-cycle', async () => {
      const id = await rawInsert(dataSource, {
        codeCompte: '6',
        classe: '6',
        niveau: 1,
      });
      await expect(service.validateNoCycle(id, id)).rejects.toThrow(
        UnprocessableEntityException,
      );
    });

    it('rejects descendant-as-parent cycle', async () => {
      const idP = await rawInsert(dataSource, {
        codeCompte: '6',
        classe: '6',
        niveau: 1,
      });
      const idC = await rawInsert(dataSource, {
        codeCompte: '60',
        classe: '6',
        niveau: 2,
        parentId: idP,
      });
      await expect(service.validateNoCycle(idP, idC)).rejects.toThrow(
        /Cycle hiérarchique/,
      );
    });
  });

  // ─── createNewVersionCompte — validations

  describe('createNewVersionCompte (validations)', () => {
    it('rejects when parent does not exist', async () => {
      await expect(
        service.createNewVersionCompte(
          'X',
          {
            libelle: 'X',
            classe: '6',
            niveau: 2,
            fkCompteParent: '999999',
          } as Partial<DimCompte>,
          'tester',
        ),
      ).rejects.toThrow(/introuvable/);
    });

    it('rejects when child niveau != parent niveau + 1', async () => {
      const idP = await rawInsert(dataSource, {
        codeCompte: '6',
        classe: '6',
        niveau: 1,
      });
      await expect(
        service.createNewVersionCompte(
          'X',
          {
            libelle: 'X',
            classe: '6',
            niveau: 4, // doit être 2
            fkCompteParent: idP,
          } as Partial<DimCompte>,
          'tester',
        ),
      ).rejects.toThrow(/Incohérence niveau/);
    });

    it('accepte un compte niveau 6 sous un parent niveau 5 (PCB profond, Lot 8.8)', async () => {
      const id5 = await rawInsert(dataSource, {
        codeCompte: '60111',
        classe: '6',
        niveau: 5,
        sens: 'D',
      });
      await service.createNewVersionCompte(
        '601111',
        {
          libelle: 'Fournitures bureau',
          classe: '6',
          niveau: 6,
          fkCompteParent: id5,
          sens: 'D',
        } as Partial<DimCompte>,
        'tester',
      );
      const rows = (await dataSource.query(
        `SELECT niveau FROM dim_compte WHERE code_compte = '601111' AND version_courante = true`,
      )) as Array<{ niveau: number }>;
      expect(rows[0]!.niveau).toBe(6);
    });

    it('rejects when child classe != parent classe', async () => {
      const idP = await rawInsert(dataSource, {
        codeCompte: '6',
        classe: '6',
        niveau: 1,
      });
      await expect(
        service.createNewVersionCompte(
          'X',
          {
            libelle: 'X',
            classe: '7',
            niveau: 2,
            fkCompteParent: idP,
          } as Partial<DimCompte>,
          'tester',
        ),
      ).rejects.toThrow(/Incohérence classe/);
    });
  });

  // ─── Smart update (4-cas)

  describe('update (4-cas)', () => {
    let idP: string;

    beforeEach(async () => {
      idP = await rawInsert(dataSource, {
        codeCompte: '6',
        classe: '6',
        niveau: 1,
        sens: 'D',
        dateDebutValidite: '2024-01-01',
      });
      await rawInsert(dataSource, {
        codeCompte: '60',
        classe: '6',
        niveau: 2,
        parentId: idP,
        sens: 'D',
        dateDebutValidite: '2024-01-01',
      });
    });

    it('changing libelle on a past version → modeMaj=nouvelle_version (2 rows)', async () => {
      const updated = await service.update(
        '60',
        { libelle: 'Renommé' },
        'admin@miznas.local',
      );
      expect(updated.modeMaj).toBe('nouvelle_version');
      const history = await service.findHistory('60');
      expect(history).toHaveLength(2);
    });

    it('changing libelle on TODAY version → modeMaj=ecrasement_intra_jour', async () => {
      // Re-insert 60 today.
      await dataSource.query("DELETE FROM dim_compte WHERE code_compte = '60'");
      await rawInsert(dataSource, {
        codeCompte: '60',
        classe: '6',
        niveau: 2,
        parentId: idP,
        sens: 'D',
        // dateDebutValidite défaut = today
      });

      const updated = await service.update(
        '60',
        { libelle: 'Renommé intra-jour' },
        'admin@miznas.local',
      );
      expect(updated.modeMaj).toBe('ecrasement_intra_jour');
      const history = await service.findHistory('60');
      expect(history).toHaveLength(1);
    });

    it('changing only estActif → modeMaj=in_place_est_actif', async () => {
      const updated = await service.update(
        '60',
        { estActif: false },
        'admin@miznas.local',
      );
      expect(updated.modeMaj).toBe('in_place_est_actif');
    });

    it('throws NotFoundException for unknown codeCompte', async () => {
      await expect(
        service.update('UNKNOWN', { libelle: 'X' }, 'tester'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── relinkAfterCompteRevision (auto-référence)

  describe('relinkAfterCompteRevision', () => {
    it('updates 1 enfant pointing to old parent id', async () => {
      const oldP = await rawInsert(dataSource, {
        codeCompte: '6',
        classe: '6',
        niveau: 1,
      });
      await rawInsert(dataSource, {
        codeCompte: '60',
        classe: '6',
        niveau: 2,
        parentId: oldP,
      });
      const newP = await rawInsert(dataSource, {
        codeCompte: '6_NEW',
        classe: '6',
        niveau: 1,
      });

      const result = await service.relinkAfterCompteRevision(
        oldP,
        newP,
        'admin@miznas.local',
      );
      expect(result.count).toBe(1);
      const child = await service.findCurrent('60');
      expect(String(child!.fkCompteParent)).toBe(newP);
    });

    it('returns count=0 when no child points to the old id', async () => {
      const oldP = await rawInsert(dataSource, {
        codeCompte: '6',
        classe: '6',
        niveau: 1,
      });
      const newP = await rawInsert(dataSource, {
        codeCompte: '6_NEW',
        classe: '6',
        niveau: 1,
      });
      const result = await service.relinkAfterCompteRevision(
        oldP,
        newP,
        'tester',
      );
      expect(result.count).toBe(0);
    });
  });

  // ─── desactiver

  describe('desactiver', () => {
    it('refuses when the compte has current children', async () => {
      const idP = await rawInsert(dataSource, {
        codeCompte: '6',
        classe: '6',
        niveau: 1,
      });
      await rawInsert(dataSource, {
        codeCompte: '60',
        classe: '6',
        niveau: 2,
        parentId: idP,
      });
      await expect(
        service.desactiver('6', 'admin@miznas.local'),
      ).rejects.toThrow(ConflictException);
    });

    it('soft-closes a leaf compte', async () => {
      await rawInsert(dataSource, { codeCompte: '6', classe: '6', niveau: 1 });
      await service.desactiver('6', 'admin@miznas.local');
      const history = await service.findHistory('6');
      expect(history[0]!.versionCourante).toBe(false);
      expect(history[0]!.estActif).toBe(false);
    });
  });

  // ─── create

  describe('create', () => {
    it('creates a new root compte (niveau 1, no parent)', async () => {
      const created = await service.create(
        {
          codeCompte: '6',
          libelle: 'CHARGES',
          classe: '6',
          niveau: 1,
          sens: 'D',
        },
        'admin@miznas.local',
      );
      expect(created.codeCompte).toBe('6');
    });

    it('rejects creating a root compte with niveau != 1', async () => {
      await expect(
        service.create(
          {
            codeCompte: '6',
            libelle: 'CHARGES',
            classe: '6',
            niveau: 2,
          },
          'admin@miznas.local',
        ),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('rejects duplicate codeCompte', async () => {
      await rawInsert(dataSource, { codeCompte: '6', classe: '6', niveau: 1 });
      await expect(
        service.create(
          {
            codeCompte: '6',
            libelle: 'Dup',
            classe: '6',
            niveau: 1,
          },
          'admin@miznas.local',
        ),
      ).rejects.toThrow(ConflictException);
    });
  });

  // ─── findAllPaginated — recherche + filtres serveur (Option B)

  describe('findAllPaginated', () => {
    beforeEach(async () => {
      // 6 (racine) > 63 > 631 > 6311 > 63111 ; + 7 (autre racine) inactif.
      const id6 = await rawInsert(dataSource, {
        codeCompte: '6',
        libelle: 'Charges',
        classe: '6',
        niveau: 1,
      });
      const id63 = await rawInsert(dataSource, {
        codeCompte: '63',
        libelle: 'Impôts et taxes',
        classe: '6',
        niveau: 2,
        parentId: id6,
      });
      const id631 = await rawInsert(dataSource, {
        codeCompte: '631',
        libelle: 'Impôts directs',
        classe: '6',
        niveau: 3,
        parentId: id63,
      });
      const id6311 = await rawInsert(dataSource, {
        codeCompte: '6311',
        libelle: 'Patente',
        classe: '6',
        niveau: 4,
        parentId: id631,
      });
      await rawInsert(dataSource, {
        codeCompte: '63111',
        libelle: 'Patente principale',
        classe: '6',
        niveau: 5,
        parentId: id6311,
      });
      await rawInsert(dataSource, {
        codeCompte: '7',
        libelle: 'Produits',
        classe: '7',
        niveau: 1,
        estActif: false,
      });
    });

    it('recherche par CODE "6311" → trouve 6311 (et 63111)', async () => {
      const res = await service.findAllPaginated({
        search: '6311',
        page: 1,
        limit: 50,
        versionCouranteUniquement: true,
      } as never);
      const codes = res.items.map((c) => c.codeCompte).sort();
      expect(codes).toEqual(['6311', '63111']);
    });

    it('recherche par LIBELLÉ "Impôts" → trouve les comptes correspondants', async () => {
      const res = await service.findAllPaginated({
        search: 'Impôts',
        page: 1,
        limit: 50,
        versionCouranteUniquement: true,
      } as never);
      const codes = res.items.map((c) => c.codeCompte).sort();
      expect(codes).toEqual(['63', '631']);
    });

    it('filtre niveau=4 côté serveur → uniquement le niveau 4', async () => {
      const res = await service.findAllPaginated({
        niveau: 4,
        page: 1,
        limit: 50,
        versionCouranteUniquement: true,
      } as never);
      expect(res.items.map((c) => c.codeCompte)).toEqual(['6311']);
    });

    it('racinesUniquement → uniquement les comptes sans parent', async () => {
      const res = await service.findAllPaginated({
        racinesUniquement: true,
        page: 1,
        limit: 50,
        versionCouranteUniquement: true,
      } as never);
      expect(res.items.map((c) => c.codeCompte).sort()).toEqual(['6', '7']);
    });

    it('actifsUniquement → exclut le compte inactif (7)', async () => {
      const res = await service.findAllPaginated({
        actifsUniquement: true,
        racinesUniquement: true,
        page: 1,
        limit: 50,
        versionCouranteUniquement: true,
      } as never);
      expect(res.items.map((c) => c.codeCompte)).toEqual(['6']);
    });

    it('pagination : total reflète l’ensemble, items limités à la page', async () => {
      const res = await service.findAllPaginated({
        page: 1,
        limit: 2,
        versionCouranteUniquement: true,
      } as never);
      expect(res.total).toBe(6);
      expect(res.items).toHaveLength(2);
      expect(res.limit).toBe(2);
    });
  });
});
