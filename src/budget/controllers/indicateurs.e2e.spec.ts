/**
 * Tests e2e /api/v1/budget/indicateurs (Lot 3.6).
 *
 * Vérifie :
 *  - GET /globaux : permission BUDGET.LIRE, filtrage périmètre,
 *    cohérence des sommes.
 *  - GET /par-cr : 1 ligne par CR accessible.
 *  - GET /comparaison : N scénarios côte à côte.
 *
 * `mv_indicateurs_budget` est simulée par une `TABLE` (pg-mem ne
 * supporte pas les MATERIALIZED VIEW). Le test refresh est couvert
 * en unitaire.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LoggerModule } from 'nestjs-pino';
import { DataType, newDb } from 'pg-mem';
import request from 'supertest';
import { DataSource, DataSourceOptions } from 'typeorm';

import { AuditModule } from '../../audit/audit.module';
import { AuditInterceptor } from '../../audit/interceptors/audit.interceptor';
import { AuthModule } from '../../auth/auth.module';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { BudgetModule } from '../budget.module';
import { AllExceptionsFilter } from '../../common/filters/all-exceptions.filter';
import { CentreResponsabiliteModule } from '../../referentiels/centre-responsabilite/centre-responsabilite.module';
import { CompteModule } from '../../referentiels/compte/compte.module';
import { DeviseModule } from '../../referentiels/devise/devise.module';
import { LigneMetierModule } from '../../referentiels/ligne-metier/ligne-metier.module';
import { ProduitModule } from '../../referentiels/produit/produit.module';
import { ScenarioModule } from '../../referentiels/scenario/scenario.module';
import { SegmentModule } from '../../referentiels/segment/segment.module';
import { StructureModule } from '../../referentiels/structure/structure.module';
import { TempsModule } from '../../referentiels/temps/temps.module';
import { VersionModule } from '../../referentiels/version/version.module';
import { RolesModule } from '../../roles/roles.module';
import { UsersModule } from '../../users/users.module';

interface SeedIds {
  adminId: string;
  preparateurCivId: string;
  lecteurId: string;
  crCivId: string;
  crBfaId: string;
  versionId: string;
  scenarioMedianId: string;
  scenarioOptimisteId: string;
}

async function seedAll(ds: DataSource): Promise<SeedIds> {
  // Permissions + rôles
  for (const [code, libelle, mod] of [
    ['BUDGET.LIRE', 'Lire budget', 'BUDGET'],
    ['BUDGET.SAISIR', 'Saisir budget', 'BUDGET'],
  ]) {
    await ds.query(
      `INSERT INTO ref_permission (code_permission, libelle, module, utilisateur_creation)
       VALUES ($1, $2, $3, 'system')`,
      [code, libelle, mod],
    );
  }
  for (const [code, libelle] of [
    ['ADMIN', 'Admin'],
    ['LECTEUR', 'Lecteur'],
    ['PREPARATEUR_CIV', "Préparateur Côte d'Ivoire"],
  ]) {
    await ds.query(
      `INSERT INTO ref_role (code_role, libelle, est_actif, utilisateur_creation)
       VALUES ($1, $2, true, 'system')`,
      [code, libelle],
    );
  }
  for (const [r, p] of [
    ['ADMIN', 'BUDGET.LIRE'],
    ['ADMIN', 'BUDGET.SAISIR'],
    ['LECTEUR', 'BUDGET.LIRE'],
    ['PREPARATEUR_CIV', 'BUDGET.LIRE'],
  ]) {
    await ds.query(
      `INSERT INTO bridge_role_permission (fk_role, fk_permission)
       VALUES (
         (SELECT id FROM ref_role WHERE code_role = $1),
         (SELECT id FROM ref_permission WHERE code_permission = $2)
       )`,
      [r, p],
    );
  }

  // Users
  await ds.query(
    `INSERT INTO "user" (email, mot_de_passe_hash, nom, prenom, est_actif, utilisateur_creation)
     VALUES
       ('admin@miznas.local',         'placeholder', 'Admin',  'X', true, 'system'),
       ('preparateur-civ@miznas.local','placeholder','PrepCIV','X', true, 'system'),
       ('lecteur@miznas.local',       'placeholder','Lecteur','X', true, 'system')`,
  );
  const users = (await ds.query(`SELECT email, id FROM "user"`)) as Array<{
    email: string;
    id: string;
  }>;
  const userIdByEmail = new Map(users.map((u) => [u.email, String(u.id)]));

  // Structures + CR (pour le périmètre PREPARATEUR_CIV)
  await ds.query(
    `INSERT INTO dim_structure
       (code_structure, libelle, type_structure, niveau_hierarchique,
        version_courante, est_actif, date_debut_validite,
        utilisateur_creation, fk_structure_parent)
     VALUES
       ($1, $2, 'siege', 1, true, true, '2026-01-01', 'system', NULL)`,
    ['GROUP', 'Groupe'],
  );
  const groupId = String(
    (
      (await ds.query(
        `SELECT id FROM dim_structure WHERE code_structure='GROUP'`,
      )) as Array<{ id: string }>
    )[0]!.id,
  );
  await ds.query(
    `INSERT INTO dim_structure
       (code_structure, libelle, type_structure, niveau_hierarchique,
        version_courante, est_actif, date_debut_validite,
        utilisateur_creation, fk_structure_parent)
     VALUES
       ($1, $2, 'filiale', 2, true, true, '2026-01-01', 'system', $3),
       ($4, $5, 'filiale', 2, true, true, '2026-01-01', 'system', $3)`,
    ['CIV', 'Cote Ivoire', groupId, 'BFA', 'Burkina Faso'],
  );
  const civStructFromInsert = String(
    (
      (await ds.query(
        `SELECT id FROM dim_structure WHERE code_structure='CIV'`,
      )) as Array<{ id: string }>
    )[0]!.id,
  );
  const bfaStructId = String(
    (
      (await ds.query(
        `SELECT id FROM dim_structure WHERE code_structure='BFA'`,
      )) as Array<{ id: string }>
    )[0]!.id,
  );
  await ds.query(
    `INSERT INTO dim_centre_responsabilite
       (code_cr, libelle, type_cr, fk_structure, version_courante,
        est_actif, date_debut_validite, utilisateur_creation)
     VALUES
       ($1, $2, 'branche', $3, true, true, '2026-01-01', 'system'),
       ($4, $5, 'branche', $6, true, true, '2026-01-01', 'system')`,
    [
      'BR_CIV',
      'Branche CIV',
      civStructFromInsert,
      'BR_BFA',
      'Branche BFA',
      bfaStructId,
    ],
  );
  const crs = (await ds.query(
    `SELECT code_cr, id FROM dim_centre_responsabilite`,
  )) as Array<{ code_cr: string; id: string }>;
  const crIdByCode = new Map(crs.map((c) => [c.code_cr, String(c.id)]));
  const civStructureId = civStructFromInsert;

  // Rôles → users (admin global, lecteur global, preparateur-civ
  // limité à la structure CIV)
  for (const [email, role, ptype, pid] of [
    ['admin@miznas.local', 'ADMIN', 'global', null],
    ['lecteur@miznas.local', 'LECTEUR', 'global', null],
    [
      'preparateur-civ@miznas.local',
      'PREPARATEUR_CIV',
      'structure',
      String(civStructureId),
    ],
  ] as Array<[string, string, string, string | null]>) {
    const roleRows = (await ds.query(
      `SELECT id FROM ref_role WHERE code_role = $1`,
      [role],
    )) as Array<{ id: string }>;
    await ds.query(
      `INSERT INTO bridge_user_role
         (fk_user, fk_role, perimetre_type, perimetre_id, est_actif, utilisateur_creation)
       VALUES ($1, $2, $3, $4, true, 'system')`,
      [userIdByEmail.get(email), String(roleRows[0]!.id), ptype, pid],
    );
  }

  // Version + 2 scénarios
  await ds.query(
    `INSERT INTO dim_version (code_version, libelle, type_version, exercice_fiscal, statut, utilisateur_creation)
     VALUES ('BI_2027', 'Budget initial 2027', 'budget_initial', 2027, 'ouvert', 'system')`,
  );
  await ds.query(
    `INSERT INTO dim_scenario (code_scenario, libelle, type_scenario, statut, exercice_fiscal, utilisateur_creation)
     VALUES
       ('MEDIAN_2027',    'Médian 2027',    'central',   'actif', 2027, 'system'),
       ('OPTIMISTE_2027', 'Optimiste 2027', 'optimiste', 'actif', 2027, 'system')`,
  );
  const versionId = String(
    (
      (await ds.query(
        `SELECT id FROM dim_version WHERE code_version='BI_2027'`,
      )) as Array<{ id: string }>
    )[0]!.id,
  );
  const scs = (await ds.query(
    `SELECT code_scenario, id FROM dim_scenario`,
  )) as Array<{ code_scenario: string; id: string }>;
  const scenarioIdByCode = new Map(
    scs.map((s) => [s.code_scenario, String(s.id)]),
  );

  return {
    adminId: userIdByEmail.get('admin@miznas.local')!,
    preparateurCivId: userIdByEmail.get('preparateur-civ@miznas.local')!,
    lecteurId: userIdByEmail.get('lecteur@miznas.local')!,
    crCivId: crIdByCode.get('BR_CIV')!,
    crBfaId: crIdByCode.get('BR_BFA')!,
    versionId,
    scenarioMedianId: scenarioIdByCode.get('MEDIAN_2027')!,
    scenarioOptimisteId: scenarioIdByCode.get('OPTIMISTE_2027')!,
  };
}

async function seedMv(
  ds: DataSource,
  ids: SeedIds,
  scenarioId: string,
  crId: string,
  codeCr: string,
  libelleCr: string,
  totals: { c6: number; c7: number; t67: number; t76: number; charges: number },
): Promise<void> {
  const pnb = totals.c7 - totals.t67;
  const mni = totals.t76 - totals.t67;
  await ds.query(
    `INSERT INTO mv_indicateurs_budget VALUES
      ($1,$2,$3,$4,$5,2027,$6,$7,$8,$9,$10,$11,$12,12,'2026-05-01T10:00:00Z')`,
    [
      ids.versionId,
      scenarioId,
      crId,
      codeCr,
      libelleCr,
      totals.c6,
      totals.c7,
      totals.t67,
      totals.t76,
      pnb,
      mni,
      totals.charges,
    ],
  );
}

describe('IndicateursController (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let ids: SeedIds;
  let adminToken: string;
  let preparateurCivToken: string;
  let lecteurToken: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET =
      'test-secret-indicateurs-e2e-min-32-chars-aaaaaaaaaa';
    process.env.JWT_ACCESS_EXPIRES_IN = '15m';
    process.env.JWT_REFRESH_EXPIRES_IN = '7d';
    process.env.BCRYPT_ROUNDS = '4';
    process.env.DB_HOST = 'localhost';
    process.env.DB_PORT = '5432';
    process.env.DB_USER = 'postgres';
    process.env.DB_PASSWORD = 'unused';
    process.env.DB_NAME = 'unused';

    const memDb = newDb({ autoCreateForeignKeyIndices: true });
    memDb.public.registerFunction({
      name: 'current_database',
      args: [],
      returns: DataType.text,
      implementation: () => 'test',
    });
    memDb.public.registerFunction({
      name: 'version',
      args: [],
      returns: DataType.text,
      implementation: () => 'PostgreSQL 15 (pg-mem)',
    });

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        LoggerModule.forRoot({ pinoHttp: { level: 'silent' } }),
        TypeOrmModule.forRootAsync({
          useFactory: () => ({
            type: 'postgres' as const,
            database: 'test',
            synchronize: true,
            autoLoadEntities: true,
          }),
          dataSourceFactory: async (options?: DataSourceOptions) => {
            if (!options) throw new Error('TypeOrm options required');
            const ds = memDb.adapters.createTypeormDataSource(
              options,
            ) as DataSource;
            await ds.initialize();
            return ds;
          },
        }),
        UsersModule,
        RolesModule,
        AuditModule,
        AuthModule,
        // Modules dimensions nécessaires aux entités relationnelles
        // chargées par BudgetModule (FaitBudget référence toutes les
        // dim — il faut les enregistrer pour que TypeORM résolve les
        // métadonnées de relation au démarrage).
        TempsModule,
        DeviseModule,
        StructureModule,
        CentreResponsabiliteModule,
        CompteModule,
        LigneMetierModule,
        ProduitModule,
        SegmentModule,
        VersionModule,
        ScenarioModule,
        BudgetModule,
      ],
      providers: [
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: PermissionsGuard },
        { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();

    dataSource = app.get(DataSource);
    const jwtService = app.get(JwtService);

    // Crée la table substitut de mv_indicateurs_budget (pg-mem ne
    // supporte pas MATERIALIZED VIEW).
    await dataSource.query(`
      CREATE TABLE mv_indicateurs_budget (
        fk_version                bigint NOT NULL,
        fk_scenario               bigint NOT NULL,
        fk_centre                 bigint NOT NULL,
        code_cr                   varchar(50) NOT NULL,
        libelle_cr                varchar(200) NOT NULL,
        exercice                  int NOT NULL,
        total_classe_6            numeric(20,2) NOT NULL,
        total_classe_7            numeric(20,2) NOT NULL,
        total_67_charges_interets numeric(20,2) NOT NULL,
        total_76_produits_interets numeric(20,2) NOT NULL,
        pnb                       numeric(20,2) NOT NULL,
        mni                       numeric(20,2) NOT NULL,
        charges_hors_interets     numeric(20,2) NOT NULL,
        nb_lignes                 int NOT NULL,
        derniere_modif            timestamp NULL
      )
    `);

    ids = await seedAll(dataSource);

    adminToken = await jwtService.signAsync({
      sub: ids.adminId,
      email: 'admin@miznas.local',
      jti: 'jti-admin-ind',
    });
    preparateurCivToken = await jwtService.signAsync({
      sub: ids.preparateurCivId,
      email: 'preparateur-civ@miznas.local',
      jti: 'jti-prep-civ-ind',
    });
    lecteurToken = await jwtService.signAsync({
      sub: ids.lecteurId,
      email: 'lecteur@miznas.local',
      jti: 'jti-lecteur-ind',
    });

    // Données : 2 CR × 2 scénarios pour MEDIAN, 1 CR pour OPTIMISTE.
    await seedMv(
      dataSource,
      ids,
      ids.scenarioMedianId,
      ids.crCivId,
      'BR_CIV',
      'Branche CIV',
      { c6: 60, c7: 100, t67: 20, t76: 30, charges: 40 },
    );
    await seedMv(
      dataSource,
      ids,
      ids.scenarioMedianId,
      ids.crBfaId,
      'BR_BFA',
      'Branche BFA',
      { c6: 35, c7: 50, t67: 10, t76: 15, charges: 25 },
    );
    await seedMv(
      dataSource,
      ids,
      ids.scenarioOptimisteId,
      ids.crCivId,
      'BR_CIV',
      'Branche CIV',
      { c6: 60, c7: 130, t67: 20, t76: 30, charges: 40 },
    );
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('GET /indicateurs/globaux sans token → 401', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/budget/indicateurs/globaux')
      .query({
        versionId: ids.versionId,
        scenarioId: ids.scenarioMedianId,
        exerciceFiscal: 2027,
      })
      .expect(401);
  });

  it('GET /indicateurs/globaux avec admin → somme des 2 CR', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/budget/indicateurs/globaux')
      .query({
        versionId: ids.versionId,
        scenarioId: ids.scenarioMedianId,
        exerciceFiscal: 2027,
      })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    // PNB = (100-20) + (50-10) = 120
    expect(Number(res.body.pnb)).toBe(120);
    expect(Number(res.body.totalProduits)).toBe(150);
    expect(res.body.nbCrInclus).toBe(2);
  });

  it('GET /indicateurs/globaux avec preparateur_civ → seul BR_CIV', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/budget/indicateurs/globaux')
      .query({
        versionId: ids.versionId,
        scenarioId: ids.scenarioMedianId,
        exerciceFiscal: 2027,
      })
      .set('Authorization', `Bearer ${preparateurCivToken}`)
      .expect(200);
    expect(Number(res.body.pnb)).toBe(80); // 100-20
    expect(res.body.nbCrInclus).toBe(1);
  });

  it('GET /indicateurs/par-cr avec admin → 2 lignes triées par CR', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/budget/indicateurs/par-cr')
      .query({
        versionId: ids.versionId,
        scenarioId: ids.scenarioMedianId,
        exerciceFiscal: 2027,
      })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(2);
    const civ = (
      res.body as Array<{
        codeCr: string;
        pnb: number;
        coefExploitation: number | null;
      }>
    ).find((r) => r.codeCr === 'BR_CIV')!;
    expect(Number(civ.pnb)).toBe(80);
    // coef = 40 / 80 × 100 = 50
    expect(Number(civ.coefExploitation)).toBe(50);
  });

  it('GET /indicateurs/comparaison → 2 scénarios pour la version', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/budget/indicateurs/comparaison')
      .query({ versionId: ids.versionId, exerciceFiscal: 2027 })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(res.body.version.codeVersion).toBe('BI_2027');
    expect(res.body.scenarios).toHaveLength(2);
    const opt = (
      res.body.scenarios as Array<{ codeScenario: string; pnb: number }>
    ).find((s) => s.codeScenario === 'OPTIMISTE_2027')!;
    expect(Number(opt.pnb)).toBe(110); // 130-20
  });

  it('GET /indicateurs/globaux avec lecteur → 200 (BUDGET.LIRE suffit)', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/budget/indicateurs/globaux')
      .query({
        versionId: ids.versionId,
        scenarioId: ids.scenarioMedianId,
        exerciceFiscal: 2027,
      })
      .set('Authorization', `Bearer ${lecteurToken}`)
      .expect(200);
  });

  // ─── Lot 7.2 — endpoint home (KPI page d'accueil) ─────────────────
  describe('GET /indicateurs/home (Lot 7.2)', () => {
    beforeEach(async () => {
      // État initial avant chaque test : la version seedée BI_2027
      // est en `ouvert`, donc inéligible — chaque test repart de là.
      await dataSource.query(
        `UPDATE dim_version
            SET statut = 'ouvert',
                date_gel = NULL
          WHERE code_version = 'BI_2027'`,
      );
    });

    it('sans token → 401', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/budget/indicateurs/home')
        .expect(401);
    });

    it("admin + version 'gele' → defauts + indicateurs renseignés", async () => {
      await dataSource.query(
        `UPDATE dim_version
            SET statut = 'gele',
                date_gel = '2026-05-13T10:00:00Z'
          WHERE code_version = 'BI_2027'`,
      );

      const res = await request(app.getHttpServer())
        .get('/api/v1/budget/indicateurs/home')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.defauts).toMatchObject({
        codeVersion: 'BI_2027',
        codeScenario: 'MEDIAN_2027',
        exerciceFiscal: 2027,
      });
      // Délégation à IndicateursService → mêmes sommes que le test
      // GET /globaux ci-dessus pour le triplet (BI_2027, MEDIAN, 2027) :
      // PNB = (100-20) + (50-10) = 120, 2 CR inclus.
      expect(Number(res.body.indicateurs.pnb)).toBe(120);
      expect(res.body.indicateurs.nbCrInclus).toBe(2);
    });

    it('aucune version éligible → defauts:null + indicateurs:null (200)', async () => {
      // BI_2027 reste 'ouvert' (beforeEach), aucune autre version
      // seedée → cascade gele/valide/soumis ne trouve rien.
      const res = await request(app.getHttpServer())
        .get('/api/v1/budget/indicateurs/home')
        .set('Authorization', `Bearer ${lecteurToken}`)
        .expect(200);

      expect(res.body).toEqual({ defauts: null, indicateurs: null });
    });
  });
});
