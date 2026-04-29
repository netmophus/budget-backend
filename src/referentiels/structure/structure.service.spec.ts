/**
 * Tests unitaires StructureService via pg-mem.
 *
 * Limitations pg-mem documentées :
 *  - L'index unique partiel `uq_dim_structure_courante` n'est PAS
 *    créé par `synchronize:true`. L'invariant « au plus 1 version
 *    courante par BK » est porté ici par `Scd2Service.createNewVersion`
 *    (qui ferme l'ancienne avant d'insérer la nouvelle).
 *  - WITH RECURSIVE non supporté → findDescendants/findAncestors
 *    utilisent des boucles itératives JS (cf. commentaire du service).
 *  - Le rollback transactionnel n'est pas propagé fidèlement (cf.
 *    scd2.service.spec.ts). Sans incidence sur ces tests qui ne
 *    forcent pas d'erreur en cours de transaction.
 */
import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DataType, IMemoryDb, newDb } from 'pg-mem';
import { DataSource, Repository } from 'typeorm';

import { DimStructure } from './entities/dim-structure.entity';
import { StructureService } from './structure.service';

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
    entities: [DimStructure],
    synchronize: true,
  });
  await ds.initialize();
  return ds;
}

async function rawInsert(
  ds: DataSource,
  attrs: {
    codeStructure: string;
    libelle: string;
    typeStructure?: string;
    niveauHierarchique?: number;
    parentId?: string | null;
    codePays?: string | null;
    versionCourante?: boolean;
    estActif?: boolean;
    dateDebutValidite?: string;
    dateFinValidite?: string | null;
  },
): Promise<string> {
  const today = new Date().toISOString().slice(0, 10);
  await ds.query(
    `INSERT INTO dim_structure
      ("code_structure","libelle","type_structure","niveau_hierarchique",
       "fk_structure_parent","code_pays","date_debut_validite",
       "date_fin_validite","version_courante","est_actif","utilisateur_creation")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'system')`,
    [
      attrs.codeStructure,
      attrs.libelle,
      attrs.typeStructure ?? 'agence',
      attrs.niveauHierarchique ?? 5,
      attrs.parentId ?? null,
      attrs.codePays ?? null,
      attrs.dateDebutValidite ?? today,
      attrs.dateFinValidite ?? null,
      attrs.versionCourante ?? true,
      attrs.estActif ?? true,
    ],
  );
  const rows = (await ds.query(
    `SELECT id FROM dim_structure
     WHERE code_structure = $1 AND version_courante = $2
     ORDER BY id DESC LIMIT 1`,
    [attrs.codeStructure, attrs.versionCourante ?? true],
  )) as Array<{ id: string }>;
  return String(rows[0]!.id);
}

describe('StructureService', () => {
  let dataSource: DataSource;
  let repo: Repository<DimStructure>;
  let service: StructureService;

  beforeAll(async () => {
    dataSource = await createDataSource();
    repo = dataSource.getRepository(DimStructure);
    service = new StructureService(repo, dataSource);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    // Casser la FK auto-référente avant le DELETE — sinon RESTRICT
    // bloque la suppression des parents par les enfants.
    await dataSource.query('UPDATE dim_structure SET fk_structure_parent = NULL');
    await dataSource.query('DELETE FROM dim_structure');
  });

  // ─── SCD2 hérité (validation que l'héritage marche en condition réelle)

  describe('SCD2 inherited from Scd2Service', () => {
    it('findCurrent returns the row with versionCourante=true', async () => {
      await rawInsert(dataSource, {
        codeStructure: 'X',
        libelle: 'Old',
        versionCourante: false,
        dateDebutValidite: '2025-01-01',
        dateFinValidite: '2026-01-01',
      });
      await rawInsert(dataSource, {
        codeStructure: 'X',
        libelle: 'Current',
        versionCourante: true,
        dateDebutValidite: '2026-01-01',
      });

      const current = await service.findCurrent('X');
      expect(current?.libelle).toBe('Current');
    });

    it('findHistory returns versions in ascending chronological order', async () => {
      await rawInsert(dataSource, {
        codeStructure: 'X',
        libelle: 'V1',
        dateDebutValidite: '2024-01-01',
        dateFinValidite: '2025-01-01',
        versionCourante: false,
      });
      await rawInsert(dataSource, {
        codeStructure: 'X',
        libelle: 'V2',
        dateDebutValidite: '2025-01-01',
        versionCourante: true,
      });

      const history = await service.findHistory('X');
      expect(history.map((h) => h.libelle)).toEqual(['V1', 'V2']);
    });

    it('createNewVersionStructure closes the old version and opens a new one', async () => {
      // Type entite_juridique : aucune contrainte de parent (cf. assertion
      // métier du service). Évite de coupler ce test SCD2 à la cohérence
      // type/niveau testée séparément plus bas.
      await rawInsert(dataSource, {
        codeStructure: 'A',
        libelle: 'Old',
        typeStructure: 'entite_juridique',
        niveauHierarchique: 1,
      });

      const today = new Date().toISOString().slice(0, 10);
      const created = await service.createNewVersionStructure(
        'A',
        {
          libelle: 'New',
          typeStructure: 'entite_juridique',
          niveauHierarchique: 1,
          fkStructureParent: null,
        } as Partial<DimStructure>,
        'tester',
      );

      expect(created.libelle).toBe('New');
      expect(created.versionCourante).toBe(true);
      expect(created.dateDebutValidite).toBe(today);
      expect(created.dateFinValidite).toBeNull();

      const all = await service.findHistory('A');
      expect(all).toHaveLength(2);
      const old = all.find((v) => v.libelle === 'Old')!;
      expect(old.versionCourante).toBe(false);
      expect(old.dateFinValidite).toBe(today);
    });

    it('softClose closes the current version without creating a new one', async () => {
      await rawInsert(dataSource, {
        codeStructure: 'A',
        libelle: 'X',
        typeStructure: 'agence',
        niveauHierarchique: 5,
      });

      await service.softClose('A', 'tester');

      const all = await service.findHistory('A');
      expect(all).toHaveLength(1);
      expect(all[0]!.versionCourante).toBe(false);
      expect(all[0]!.estActif).toBe(false);
    });
  });

  // ─── Hiérarchie

  describe('Hierarchy methods', () => {
    let socId: string;
    let brCivId: string;
    let dirRetailId: string;
    let dirCorpId: string;
    let agPlateauId: string;

    beforeEach(async () => {
      socId = await rawInsert(dataSource, {
        codeStructure: 'SOC',
        libelle: 'Société',
        typeStructure: 'entite_juridique',
        niveauHierarchique: 1,
      });
      brCivId = await rawInsert(dataSource, {
        codeStructure: 'BR_CIV',
        libelle: 'Branche CIV',
        typeStructure: 'branche',
        niveauHierarchique: 2,
        parentId: socId,
        codePays: 'CIV',
      });
      dirRetailId = await rawInsert(dataSource, {
        codeStructure: 'DIR_RETAIL',
        libelle: 'Dir Retail',
        typeStructure: 'direction',
        niveauHierarchique: 3,
        parentId: brCivId,
        codePays: 'CIV',
      });
      dirCorpId = await rawInsert(dataSource, {
        codeStructure: 'DIR_CORP',
        libelle: 'Dir Corp',
        typeStructure: 'direction',
        niveauHierarchique: 3,
        parentId: brCivId,
        codePays: 'CIV',
      });
      agPlateauId = await rawInsert(dataSource, {
        codeStructure: 'AG_PLATEAU',
        libelle: 'Ag Plateau',
        typeStructure: 'agence',
        niveauHierarchique: 4,
        parentId: dirRetailId,
        codePays: 'CIV',
      });
    });

    it('findChildren returns direct children only', async () => {
      const children = await service.findChildren(brCivId);
      const codes = children.map((c) => c.codeStructure).sort();
      expect(codes).toEqual(['DIR_CORP', 'DIR_RETAIL']);
    });

    it('findDescendants returns all descendants recursively (iterative impl)', async () => {
      const descendants = await service.findDescendants(socId);
      const codes = descendants.map((d) => d.codeStructure).sort();
      expect(codes).toEqual([
        'AG_PLATEAU',
        'BR_CIV',
        'DIR_CORP',
        'DIR_RETAIL',
      ]);
    });

    it('findAncestors walks up to the root', async () => {
      const ancestors = await service.findAncestors(agPlateauId);
      const codes = ancestors.map((a) => a.codeStructure);
      // Du plus proche au plus éloigné.
      expect(codes).toEqual(['DIR_RETAIL', 'BR_CIV', 'SOC']);
      expect(dirCorpId).toBeDefined(); // garde-fou : DIR_CORP existe mais ne doit PAS être dans la chaîne
    });

    it('findRoots returns structures without parent in current version', async () => {
      const roots = await service.findRoots();
      expect(roots.map((r) => r.codeStructure)).toEqual(['SOC']);
    });
  });

  // ─── validateNoCycle

  describe('validateNoCycle', () => {
    let socId: string;
    let brId: string;
    let agId: string;

    beforeEach(async () => {
      socId = await rawInsert(dataSource, {
        codeStructure: 'SOC',
        libelle: 'S',
        typeStructure: 'entite_juridique',
        niveauHierarchique: 1,
      });
      brId = await rawInsert(dataSource, {
        codeStructure: 'BR',
        libelle: 'B',
        typeStructure: 'branche',
        niveauHierarchique: 2,
        parentId: socId,
      });
      agId = await rawInsert(dataSource, {
        codeStructure: 'AG',
        libelle: 'A',
        typeStructure: 'agence',
        niveauHierarchique: 3,
        parentId: brId,
      });
    });

    it('passes when nouveau parent is not a descendant', async () => {
      // BR essaie de prendre une nouvelle structure non liée comme parent.
      const otherId = await rawInsert(dataSource, {
        codeStructure: 'OTHER',
        libelle: 'O',
        typeStructure: 'entite_juridique',
        niveauHierarchique: 1,
      });
      await expect(
        service.validateNoCycle(brId, otherId),
      ).resolves.not.toThrow();
    });

    it('rejects direct self-cycle (parent = self)', async () => {
      await expect(service.validateNoCycle(brId, brId)).rejects.toThrow(
        UnprocessableEntityException,
      );
    });

    it('rejects child-as-parent cycle (B → A → B forbidden)', async () => {
      // BR essaie d'avoir AG comme parent — AG est descendant de BR.
      await expect(service.validateNoCycle(brId, agId)).rejects.toThrow(
        /Cycle hiérarchique/,
      );
    });

    it('rejects indirect cycle (SOC → BR → AG, SOC trying to be child of AG)', async () => {
      await expect(service.validateNoCycle(socId, agId)).rejects.toThrow(
        UnprocessableEntityException,
      );
    });
  });

  // ─── Cohérence type / niveau

  describe('Type / niveau coherence (createNewVersionStructure)', () => {
    it('accepts entite_juridique with niveau=1 and no parent', async () => {
      const created = await service.createNewVersionStructure(
        'SOC',
        {
          libelle: 'Société',
          typeStructure: 'entite_juridique',
          niveauHierarchique: 1,
          fkStructureParent: null,
        } as Partial<DimStructure>,
        'tester',
      );
      expect(created.codeStructure).toBe('SOC');
    });

    it('rejects entite_juridique with a parent', async () => {
      const parentId = await rawInsert(dataSource, {
        codeStructure: 'PARENT',
        libelle: 'P',
        typeStructure: 'entite_juridique',
        niveauHierarchique: 1,
      });
      await expect(
        service.createNewVersionStructure(
          'SOC',
          {
            libelle: 'X',
            typeStructure: 'entite_juridique',
            niveauHierarchique: 1,
            fkStructureParent: parentId,
          } as Partial<DimStructure>,
          'tester',
        ),
      ).rejects.toThrow(/entité juridique/);
    });

    it('rejects agence with niveau=1', async () => {
      const parentId = await rawInsert(dataSource, {
        codeStructure: 'P',
        libelle: 'P',
        typeStructure: 'entite_juridique',
        niveauHierarchique: 1,
      });
      await expect(
        service.createNewVersionStructure(
          'AG',
          {
            libelle: 'X',
            typeStructure: 'agence',
            niveauHierarchique: 1,
            fkStructureParent: parentId,
          } as Partial<DimStructure>,
          'tester',
        ),
      ).rejects.toThrow(/niveau hiérarchique >= 2/);
    });

    it('rejects when parent does not exist', async () => {
      await expect(
        service.createNewVersionStructure(
          'AG',
          {
            libelle: 'X',
            typeStructure: 'agence',
            niveauHierarchique: 5,
            fkStructureParent: '999999',
          } as Partial<DimStructure>,
          'tester',
        ),
      ).rejects.toThrow(/Parent .* introuvable/);
    });
  });

  // ─── Smart update (SCD2 vs in-place)

  describe('Smart update (SCD2 vs in-place)', () => {
    beforeEach(async () => {
      await rawInsert(dataSource, {
        codeStructure: 'AG',
        libelle: 'Original',
        typeStructure: 'agence',
        niveauHierarchique: 5,
        parentId: await rawInsert(dataSource, {
          codeStructure: 'P',
          libelle: 'P',
          typeStructure: 'entite_juridique',
          niveauHierarchique: 1,
        }),
      });
    });

    it('changing libelle creates a new SCD2 version (2 rows in history)', async () => {
      const updated = await service.update(
        'AG',
        { libelle: 'Renommée' },
        'admin@miznas.local',
      );
      expect(updated.libelle).toBe('Renommée');

      const history = await service.findHistory('AG');
      expect(history).toHaveLength(2);
      expect(history.find((h) => h.libelle === 'Original')?.versionCourante).toBe(false);
      expect(history.find((h) => h.libelle === 'Renommée')?.versionCourante).toBe(true);
    });

    it('changing only estActif=false stays in-place (still 1 row, versionCourante=true)', async () => {
      const updated = await service.update(
        'AG',
        { estActif: false },
        'admin@miznas.local',
      );
      expect(updated.estActif).toBe(false);
      expect(updated.versionCourante).toBe(true);

      const history = await service.findHistory('AG');
      expect(history).toHaveLength(1);
      expect(history[0]!.utilisateurModification).toBe('admin@miznas.local');
    });

    it('changing libelle AND estActif=false in one PATCH creates a new version with estActif=false', async () => {
      const updated = await service.update(
        'AG',
        { libelle: 'Fermée', estActif: false },
        'admin@miznas.local',
      );
      expect(updated.libelle).toBe('Fermée');
      expect(updated.estActif).toBe(false);
      expect(updated.versionCourante).toBe(true);

      const history = await service.findHistory('AG');
      expect(history).toHaveLength(2);
      const newVersion = history.find((h) => h.versionCourante)!;
      expect(newVersion.estActif).toBe(false);
      expect(newVersion.libelle).toBe('Fermée');
    });

    it('throws NotFoundException when codeStructure does not exist', async () => {
      await expect(
        service.update('UNKNOWN', { libelle: 'X' }, 'tester'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── desactiver (soft-close avec contrôle des enfants)

  describe('desactiver', () => {
    it('soft-closes a leaf structure (no children)', async () => {
      const parentId = await rawInsert(dataSource, {
        codeStructure: 'P',
        libelle: 'P',
        typeStructure: 'entite_juridique',
        niveauHierarchique: 1,
      });
      await rawInsert(dataSource, {
        codeStructure: 'AG_LEAF',
        libelle: 'Leaf',
        typeStructure: 'agence',
        niveauHierarchique: 5,
        parentId,
      });

      await service.desactiver('AG_LEAF', 'admin@miznas.local');

      const history = await service.findHistory('AG_LEAF');
      expect(history).toHaveLength(1);
      expect(history[0]!.versionCourante).toBe(false);
      expect(history[0]!.estActif).toBe(false);
    });

    it('refuses to desactivate a structure that has current children', async () => {
      const parentId = await rawInsert(dataSource, {
        codeStructure: 'P',
        libelle: 'P',
        typeStructure: 'entite_juridique',
        niveauHierarchique: 1,
      });
      await rawInsert(dataSource, {
        codeStructure: 'CHILD',
        libelle: 'C',
        typeStructure: 'branche',
        niveauHierarchique: 2,
        parentId,
      });

      await expect(
        service.desactiver('P', 'admin@miznas.local'),
      ).rejects.toThrow(ConflictException);
    });
  });

  // ─── create

  describe('create', () => {
    it('creates a new structure when codeStructure is free', async () => {
      const parentId = await rawInsert(dataSource, {
        codeStructure: 'P',
        libelle: 'P',
        typeStructure: 'entite_juridique',
        niveauHierarchique: 1,
      });
      const created = await service.create(
        {
          codeStructure: 'NEW_AG',
          libelle: 'Nouvelle agence',
          typeStructure: 'agence',
          niveauHierarchique: 5,
          fkStructureParent: parentId,
          codePays: 'CIV',
        },
        'admin@miznas.local',
      );
      expect(created.codeStructure).toBe('NEW_AG');
      expect(created.utilisateurCreation).toBe('admin@miznas.local');
    });

    it('rejects creation when codeStructure already has a current version', async () => {
      await rawInsert(dataSource, {
        codeStructure: 'EXIST',
        libelle: 'Existant',
        typeStructure: 'entite_juridique',
        niveauHierarchique: 1,
      });
      await expect(
        service.create(
          {
            codeStructure: 'EXIST',
            libelle: 'Doublon',
            typeStructure: 'entite_juridique',
            niveauHierarchique: 1,
          },
          'admin@miznas.local',
        ),
      ).rejects.toThrow(ConflictException);
    });
  });
});
