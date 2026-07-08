/**
 * Tests AnalyseIaService (Chantier C1) via pg-mem. Couvre : persistance,
 * filtrage par user, listerTout, contrôle d'accès getDetail, suppression,
 * purge 24 mois.
 */
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { DataType, IMemoryDb, newDb } from 'pg-mem';
import { DataSource } from 'typeorm';

import { AuditLog } from '../audit/entities/audit-log.entity';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/decorators/current-user.decorator';
import type { PermissionsService } from '../auth/permissions.service';
import { AnalyseIaService } from './analyse-ia.service';
import { AnalyseIa } from './entities/analyse-ia.entity';
import type { CreerAnalyseIaData } from './dto/analyse-ia.dto';

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
    implementation: () => 'PG 15',
  });
  return db;
}

async function createDataSource(): Promise<DataSource> {
  const db = buildMemDb();
  const ds = db.adapters.createTypeormDataSource({
    type: 'postgres',
    entities: [AnalyseIa, AuditLog],
    synchronize: true,
  }) as DataSource;
  await ds.initialize();
  return ds;
}

const USER1: AuthUser = { userId: '1', email: 'u1@miznas.local' };

function data(overrides: Partial<CreerAnalyseIaData> = {}): CreerAnalyseIaData {
  return {
    fkUser: '1',
    demandeurEmail: 'u1@miznas.local',
    dateGeneration: new Date(),
    versionId: '10',
    scenarioId: '20',
    moisDebut: '2027-01',
    moisFin: '2027-03',
    crsSelectionnes: null,
    modele: 'claude-sonnet-4-6',
    promptVersion: 'chantier-a-v1',
    reponseMarkdown: '## Diagnostic\nExecution maitrisee.',
    kpiSnapshot: { nbEcartsCritique: 2 },
    tokensIn: 1000,
    tokensOut: 2000,
    dureeMs: 500,
    coutEstime: 0.0033,
    dryRun: false,
    datasetSnapshot: null,
    ...overrides,
  };
}

describe('AnalyseIaService (Chantier C1)', () => {
  let ds: DataSource;
  let svc: AnalyseIaService;
  let perms: { hasPermission: jest.Mock };

  beforeAll(async () => {
    ds = await createDataSource();
  });
  afterAll(async () => {
    await ds.destroy();
  });

  beforeEach(async () => {
    await ds.query('DELETE FROM analyse_ia');
    await ds.query('DELETE FROM audit_log');
    perms = { hasPermission: jest.fn().mockResolvedValue(false) };
    svc = new AnalyseIaService(
      ds.getRepository(AnalyseIa),
      perms as unknown as PermissionsService,
      new AuditService(ds.getRepository(AuditLog)),
    );
  });

  it('creer persiste + getDetail (propriétaire) retourne le markdown + coût', async () => {
    const c = await svc.creer(data());
    const d = await svc.getDetail(c.id, USER1);
    expect(d.reponseMarkdown).toContain('Diagnostic');
    expect(d.coutEstime).toBeCloseTo(0.0033, 5);
    expect(d.promptVersion).toBe('chantier-a-v1');
  });

  it('listerPourUser : filtre sur fkUser', async () => {
    await svc.creer(data({ fkUser: '1', demandeurEmail: 'u1@miznas.local' }));
    await svc.creer(data({ fkUser: '2', demandeurEmail: 'u2@miznas.local' }));
    const r = await svc.listerPourUser('1', { page: 1, limit: 20 });
    expect(r.total).toBe(1);
    expect(r.items[0].demandeurEmail).toBe('u1@miznas.local');
  });

  it('listerTout : renvoie toutes les analyses', async () => {
    await svc.creer(data({ fkUser: '1' }));
    await svc.creer(data({ fkUser: '2' }));
    const r = await svc.listerTout({ page: 1, limit: 20 });
    expect(r.total).toBe(2);
  });

  it('getDetail : refuse l’analyse d’autrui sans AI.HISTORIQUE', async () => {
    const c = await svc.creer(data({ fkUser: '2' }));
    perms.hasPermission.mockResolvedValue(false);
    await expect(svc.getDetail(c.id, USER1)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('getDetail : autorise AI.HISTORIQUE sur l’analyse d’autrui', async () => {
    const c = await svc.creer(data({ fkUser: '2' }));
    perms.hasPermission.mockResolvedValue(true);
    const d = await svc.getDetail(c.id, USER1);
    expect(d.id).toBe(c.id);
  });

  it('supprimer : hard delete + audit ANALYSE_IA_SUPPRIMEE', async () => {
    const c = await svc.creer(data());
    await svc.supprimer(c.id, USER1);
    await expect(svc.getDetail(c.id, USER1)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    const audits = (await ds.query(
      `SELECT 1 FROM audit_log WHERE type_action='ANALYSE_IA_SUPPRIMEE'`,
    )) as unknown[];
    expect(audits).toHaveLength(1);
  });

  it('C-fix : datasetSnapshot persiste + getDetail expose hasDataset', async () => {
    const c = await svc.creer(
      data({
        datasetSnapshot: {
          ecarts: { kpi: { nbEcartsCritique: 2 }, lignes: [] },
          codeVersion: 'BI_2027',
          codeScenario: 'CENTRAL',
        },
      }),
    );
    const d = await svc.getDetail(c.id, USER1);
    expect(d.hasDataset).toBe(true);
    // Analyse sans dataset (C1) -> hasDataset false.
    const c2 = await svc.creer(data());
    const d2 = await svc.getDetail(c2.id, USER1);
    expect(d2.hasDataset).toBe(false);
  });

  it('C3 add-on : getDetail expose PNB/coef depuis le dataset (null sinon)', async () => {
    const c = await svc.creer(
      data({
        datasetSnapshot: {
          ecarts: {
            kpi: {},
            lignes: [],
            totaux: {
              pnb: { budget: 100, realise: 82 },
              coefExploitationBudget: 70,
              coefExploitationRealise: 65.2,
            },
          },
          codeVersion: 'V',
          codeScenario: 'S',
        },
      }),
    );
    const d = await svc.getDetail(c.id, USER1);
    expect(d.pnbBudget).toBe(100);
    expect(d.pnbRealise).toBe(82);
    expect(d.coefExploitationRealise).toBe(65.2);
    // Analyse C1 sans dataset -> null.
    const c2 = await svc.creer(data());
    const d2 = await svc.getDetail(c2.id, USER1);
    expect(d2.pnbBudget).toBeNull();
    expect(d2.coefExploitationRealise).toBeNull();
  });

  it('C-fix : getPourExport renvoie l’entité (avec dataset) + contrôle d’accès', async () => {
    const c = await svc.creer(
      data({
        fkUser: '2',
        datasetSnapshot: {
          ecarts: { kpi: {}, lignes: [] },
          codeVersion: 'V',
          codeScenario: 'S',
        },
      }),
    );
    // Propriétaire d'un autre -> refus sans AI.HISTORIQUE.
    perms.hasPermission.mockResolvedValue(false);
    await expect(svc.getPourExport(c.id, USER1)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    // Avec AI.HISTORIQUE -> ok + dataset présent.
    perms.hasPermission.mockResolvedValue(true);
    const e = await svc.getPourExport(c.id, USER1);
    expect(e.datasetSnapshot?.codeVersion).toBe('V');
  });

  it('purgerAnciennes : supprime les analyses > 24 mois', async () => {
    const vieux = new Date();
    vieux.setMonth(vieux.getMonth() - 25);
    await svc.creer(data({ dateGeneration: vieux }));
    await svc.creer(data({ dateGeneration: new Date() }));
    const n = await svc.purgerAnciennes();
    expect(n).toBe(1);
    const r = await svc.listerTout({ page: 1, limit: 20 });
    expect(r.total).toBe(1);
  });
});
