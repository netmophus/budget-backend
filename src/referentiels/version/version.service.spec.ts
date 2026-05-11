/**
 * Tests unitaires VersionService via pg-mem.
 *
 * Couvre :
 *  - findAll avec filtres exerciceFiscal / statut / typeVersion
 *  - findByCode (404 si absent)
 *  - create (refus doublon) + hook Q9 (Lot 3.2)
 *  - update / softDelete : refus si statut != 'ouvert' (409 Conflict)
 */
import { ConflictException, NotFoundException } from '@nestjs/common';
import { DataType, IMemoryDb, newDb } from 'pg-mem';
import { DataSource, Repository } from 'typeorm';

import { AuditLog } from '../../audit/entities/audit-log.entity';
import { AuditService } from '../../audit/audit.service';
import { DimScenario } from '../scenario/entities/dim-scenario.entity';
import { VersionService } from './version.service';
import { DimVersion } from './entities/dim-version.entity';

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
    // Lot 3.2 : DimScenario + AuditLog chargés pour permettre le hook
    // Q9 (auto-création MEDIAN + log AUTO_CREATE_SCENARIO).
    entities: [DimVersion, DimScenario, AuditLog],
    synchronize: true,
  });
  await ds.initialize();
  return ds;
}

async function rawInsert(
  ds: DataSource,
  attrs: {
    codeVersion: string;
    libelle?: string;
    typeVersion?:
      | 'budget_initial'
      | 'reforecast_1'
      | 'reforecast_2'
      | 'atterrissage';
    exerciceFiscal?: number;
    statut?: 'ouvert' | 'soumis' | 'valide' | 'gele';
  },
): Promise<string> {
  await ds.query(
    `INSERT INTO dim_version
       ("code_version","libelle","type_version","exercice_fiscal",
        "statut","utilisateur_creation")
     VALUES ($1,$2,$3,$4,$5,'system')`,
    [
      attrs.codeVersion,
      attrs.libelle ?? attrs.codeVersion,
      attrs.typeVersion ?? 'budget_initial',
      attrs.exerciceFiscal ?? 2026,
      attrs.statut ?? 'ouvert',
    ],
  );
  const rows = (await ds.query(
    `SELECT id FROM dim_version WHERE code_version = $1`,
    [attrs.codeVersion],
  )) as Array<{ id: string | number }>;
  return String(rows[0]!.id);
}

describe('VersionService', () => {
  let dataSource: DataSource;
  let repo: Repository<DimVersion>;
  let service: VersionService;
  let auditService: AuditService;

  beforeAll(async () => {
    dataSource = await createDataSource();
    repo = dataSource.getRepository(DimVersion);
    auditService = new AuditService(dataSource.getRepository(AuditLog));
    service = new VersionService(repo, dataSource, auditService);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    // Ordre : version puis scenario (pas de FK directe entre les 2).
    await dataSource.query('DELETE FROM audit_log');
    await dataSource.query('DELETE FROM dim_version');
    await dataSource.query('DELETE FROM dim_scenario');
  });

  describe('findAll', () => {
    beforeEach(async () => {
      await rawInsert(dataSource, {
        codeVersion: 'BUDGET_INITIAL_2026',
        typeVersion: 'budget_initial',
        exerciceFiscal: 2026,
      });
      await rawInsert(dataSource, {
        codeVersion: 'RF1_2026',
        typeVersion: 'reforecast_1',
        exerciceFiscal: 2026,
        statut: 'soumis',
      });
      await rawInsert(dataSource, {
        codeVersion: 'BUDGET_INITIAL_2025',
        typeVersion: 'budget_initial',
        exerciceFiscal: 2025,
        statut: 'gele',
      });
    });

    it('returns all when no filter', async () => {
      const res = await service.findAll({ page: 1, limit: 50 });
      expect(res.total).toBe(3);
    });

    it('filters by exerciceFiscal', async () => {
      const res = await service.findAll({
        page: 1,
        limit: 50,
        exerciceFiscal: 2026,
      });
      expect(res.total).toBe(2);
    });

    it('filters by statut', async () => {
      const res = await service.findAll({
        page: 1,
        limit: 50,
        statut: 'gele',
      });
      expect(res.total).toBe(1);
      expect(res.items[0]!.codeVersion).toBe('BUDGET_INITIAL_2025');
    });

    it('filters by typeVersion', async () => {
      const res = await service.findAll({
        page: 1,
        limit: 50,
        typeVersion: 'reforecast_1',
      });
      expect(res.total).toBe(1);
    });
  });

  describe('findByCode', () => {
    it('returns the version when present', async () => {
      await rawInsert(dataSource, { codeVersion: 'BUDGET_INITIAL_2026' });
      const v = await service.findByCode('BUDGET_INITIAL_2026');
      expect(v.codeVersion).toBe('BUDGET_INITIAL_2026');
    });

    it('throws NotFoundException when missing', async () => {
      await expect(service.findByCode('UNKNOWN')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('create', () => {
    it('creates a version with statut=ouvert', async () => {
      const result = await service.create(
        {
          codeVersion: 'BUDGET_INITIAL_2026',
          libelle: 'Budget initial 2026',
          typeVersion: 'budget_initial',
          exerciceFiscal: 2026,
        },
        'admin@miznas.local',
      );
      expect(result.version.statut).toBe('ouvert');
    });

    it('rejects duplicate codeVersion (409)', async () => {
      await rawInsert(dataSource, { codeVersion: 'BUDGET_INITIAL_2026' });
      await expect(
        service.create(
          {
            codeVersion: 'BUDGET_INITIAL_2026',
            libelle: 'Dup',
            typeVersion: 'budget_initial',
            exerciceFiscal: 2026,
          },
          'admin',
        ),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('update', () => {
    it('updates libelle when statut=ouvert', async () => {
      const id = await rawInsert(dataSource, {
        codeVersion: 'BUDGET_INITIAL_2026',
      });
      const updated = await service.update(
        id,
        { libelle: 'Renommé' },
        'admin@miznas.local',
      );
      expect(updated.libelle).toBe('Renommé');
      expect(updated.utilisateurModification).toBe('admin@miznas.local');
    });

    it('refuses update when statut=soumis (409)', async () => {
      const id = await rawInsert(dataSource, {
        codeVersion: 'BUDGET_INITIAL_2026',
        statut: 'soumis',
      });
      await expect(
        service.update(id, { libelle: 'X' }, 'admin'),
      ).rejects.toThrow(ConflictException);
    });

    it('refuses update when statut=gele (409)', async () => {
      const id = await rawInsert(dataSource, {
        codeVersion: 'BUDGET_INITIAL_2026',
        statut: 'gele',
      });
      await expect(
        service.update(id, { libelle: 'X' }, 'admin'),
      ).rejects.toThrow(/'gele'/);
    });

    it('throws NotFoundException for unknown id', async () => {
      await expect(
        service.update('999', { libelle: 'X' }, 'admin'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('softDelete', () => {
    it('deletes when statut=ouvert', async () => {
      const id = await rawInsert(dataSource, {
        codeVersion: 'BUDGET_INITIAL_2026',
      });
      const ok = await service.softDelete(id);
      expect(ok).toBe(true);
      const rows = (await dataSource.query(
        `SELECT COUNT(*)::int AS c FROM dim_version`,
      )) as Array<{ c: number }>;
      expect(rows[0]!.c).toBe(0);
    });

    it('refuses delete when statut=valide (409)', async () => {
      const id = await rawInsert(dataSource, {
        codeVersion: 'BUDGET_INITIAL_2026',
        statut: 'valide',
      });
      await expect(service.softDelete(id)).rejects.toThrow(ConflictException);
    });

    it('returns false when id unknown', async () => {
      expect(await service.softDelete('999')).toBe(false);
    });
  });

  // ─── Lot 3.2 : hook Q9 (auto-création scénario MEDIAN)

  describe('hook Q9 — auto-création MEDIAN', () => {
    it('aucun scénario pour 2027 → MEDIAN_2027 créé en cascade', async () => {
      const result = await service.create(
        {
          codeVersion: 'BUDGET_INITIAL_2027',
          libelle: 'Budget initial 2027',
          typeVersion: 'budget_initial',
          exerciceFiscal: 2027,
        },
        'admin@miznas.local',
      );
      expect(result.version.codeVersion).toBe('BUDGET_INITIAL_2027');
      expect(result.scenarioAutoCreeCode).toBe('MEDIAN_2027');

      const scenario = await dataSource.query(
        `SELECT code_scenario, type_scenario, statut, exercice_fiscal
           FROM dim_scenario WHERE code_scenario='MEDIAN_2027'`,
      );
      expect(scenario).toHaveLength(1);
      expect(scenario[0].type_scenario).toBe('central');
      expect(scenario[0].statut).toBe('actif');
      expect(scenario[0].exercice_fiscal).toBe(2027);
    });

    it('idempotence : si scénario existe pour exercice → pas de création', async () => {
      // Pré-condition : un scénario CENTRAL_2028 déjà rattaché à 2028.
      await dataSource.query(
        `INSERT INTO dim_scenario
           ("code_scenario","libelle","type_scenario","statut",
            "exercice_fiscal","utilisateur_creation")
         VALUES ('CENTRAL_2028','Central 2028','central','actif',2028,'system')`,
      );

      const result = await service.create(
        {
          codeVersion: 'BUDGET_INITIAL_2028',
          libelle: 'Budget initial 2028',
          typeVersion: 'budget_initial',
          exerciceFiscal: 2028,
        },
        'admin@miznas.local',
      );
      expect(result.scenarioAutoCreeCode).toBeNull();

      const count = (await dataSource.query(
        `SELECT COUNT(*)::int AS c FROM dim_scenario WHERE exercice_fiscal=2028`,
      )) as Array<{ c: number }>;
      expect(count[0]!.c).toBe(1);
    });

    it('idempotence par code : si MEDIAN_<exercice> existe déjà sans exerciceFiscal renseigné, pas de doublon', async () => {
      // Cas hérité Lot 2.4 : un scénario MEDIAN_2029 existait avec
      // exerciceFiscal=NULL. Le hook ne doit pas créer un doublon.
      await dataSource.query(
        `INSERT INTO dim_scenario
           ("code_scenario","libelle","type_scenario","statut",
            "exercice_fiscal","utilisateur_creation")
         VALUES ('MEDIAN_2029','Médian 2029 (legacy)','central','actif',NULL,'system')`,
      );

      const result = await service.create(
        {
          codeVersion: 'BUDGET_INITIAL_2029',
          libelle: 'Budget 2029',
          typeVersion: 'budget_initial',
          exerciceFiscal: 2029,
        },
        'admin',
      );
      expect(result.scenarioAutoCreeCode).toBeNull();

      const count = (await dataSource.query(
        `SELECT COUNT(*)::int AS c FROM dim_scenario WHERE code_scenario='MEDIAN_2029'`,
      )) as Array<{ c: number }>;
      expect(count[0]!.c).toBe(1);
    });

    it('audit_log porte AUTO_CREATE_SCENARIO avec le déclencheur', async () => {
      await service.create(
        {
          codeVersion: 'BUDGET_INITIAL_2030',
          libelle: 'Budget 2030',
          typeVersion: 'budget_initial',
          exerciceFiscal: 2030,
        },
        'admin@miznas.local',
      );

      const audits = (await dataSource.query(
        `SELECT type_action, statut, id_cible, payload_apres, commentaire
           FROM audit_log
          WHERE type_action = 'AUTO_CREATE_SCENARIO'`,
      )) as Array<{
        type_action: string;
        statut: string;
        id_cible: string | null;
        payload_apres: {
          codeScenario?: string;
          declencheur?: { codeVersion?: string };
        };
        commentaire: string;
      }>;
      expect(audits).toHaveLength(1);
      expect(audits[0]!.statut).toBe('success');
      expect(audits[0]!.id_cible).toBe('MEDIAN_2030');
      expect(audits[0]!.payload_apres.codeScenario).toBe('MEDIAN_2030');
      expect(audits[0]!.payload_apres.declencheur?.codeVersion).toBe(
        'BUDGET_INITIAL_2030',
      );
      expect(audits[0]!.commentaire).toMatch(/Hook Q9/);
    });

    it('rollback transactionnel : si conflit codeVersion, aucun scénario auto créé', async () => {
      // Pré-condition : version existante pour 2031.
      await rawInsert(dataSource, {
        codeVersion: 'BUDGET_INITIAL_2031',
        exerciceFiscal: 2031,
      });

      await expect(
        service.create(
          {
            codeVersion: 'BUDGET_INITIAL_2031',
            libelle: 'Doublon',
            typeVersion: 'budget_initial',
            exerciceFiscal: 2031,
          },
          'admin',
        ),
      ).rejects.toThrow(ConflictException);

      // Le scénario MEDIAN_2031 NE doit PAS exister (rollback).
      const count = (await dataSource.query(
        `SELECT COUNT(*)::int AS c FROM dim_scenario WHERE code_scenario='MEDIAN_2031'`,
      )) as Array<{ c: number }>;
      expect(count[0]!.c).toBe(0);
      // Et aucun audit AUTO_CREATE_SCENARIO non plus.
      const auditCount = (await dataSource.query(
        `SELECT COUNT(*)::int AS c FROM audit_log
          WHERE type_action='AUTO_CREATE_SCENARIO' AND id_cible='MEDIAN_2031'`,
      )) as Array<{ c: number }>;
      expect(auditCount[0]!.c).toBe(0);
    });
  });
});
