/**
 * Tests e2e /api/v1/faits/budget — CRUD complet + scénario critique
 * grain unique + permissions BUDGET.LIRE / BUDGET.SAISIR /
 * BUDGET.SUPPRIMER.
 *
 * Le setup hydrate manuellement les 11 dimensions (1 ligne par dim)
 * pour avoir des FK résolvables. Le seed prod n'est pas appelé car
 * il dépend de `data-source.ts` qui n'est pas adapté à pg-mem.
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
import { FaitBudgetModule } from './fait-budget.module';

interface SeedIds {
  adminId: string;
  lecteurId: string;
}

interface DimIds {
  fkTemps: string;
  fkCompte: string;
  fkStructure: string;
  fkCentre: string;
  fkLigneMetier: string;
  fkProduit: string;
  fkSegment: string;
  fkDevise: string;
  fkVersion: string;
  fkScenario: string;
}

async function seedRolesUsers(ds: DataSource): Promise<SeedIds> {
  for (const [code, libelle, mod] of [
    ['BUDGET.LIRE', 'Lire budget', 'BUDGET'],
    ['BUDGET.SAISIR', 'Saisir budget', 'BUDGET'],
    ['BUDGET.SUPPRIMER', 'Supprimer budget', 'BUDGET'],
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
  ]) {
    await ds.query(
      `INSERT INTO ref_role (code_role, libelle, est_actif, utilisateur_creation)
       VALUES ($1, $2, true, 'system')`,
      [code, libelle],
    );
  }
  // ADMIN : 3 perms ; LECTEUR : LIRE seulement
  for (const [r, p] of [
    ['ADMIN', 'BUDGET.LIRE'],
    ['ADMIN', 'BUDGET.SAISIR'],
    ['ADMIN', 'BUDGET.SUPPRIMER'],
    ['LECTEUR', 'BUDGET.LIRE'],
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
  await ds.query(
    `INSERT INTO "user" (email, mot_de_passe_hash, nom, prenom, est_actif, utilisateur_creation)
     VALUES
       ('admin@miznas.local',  'placeholder', 'Admin',  'X', true, 'system'),
       ('lecteur@miznas.local','placeholder', 'Lecteur','X', true, 'system')`,
  );
  const users = (await ds.query(
    `SELECT email, id FROM "user" WHERE email IN ($1, $2)`,
    ['admin@miznas.local', 'lecteur@miznas.local'],
  )) as Array<{ email: string; id: string | number }>;
  const userIdByEmail = new Map(users.map((u) => [u.email, String(u.id)]));
  for (const [email, role] of [
    ['admin@miznas.local', 'ADMIN'],
    ['lecteur@miznas.local', 'LECTEUR'],
  ]) {
    const roleRows = (await ds.query(
      `SELECT id FROM ref_role WHERE code_role = $1`,
      [role],
    )) as Array<{ id: string | number }>;
    await ds.query(
      `INSERT INTO bridge_user_role (fk_user, fk_role, perimetre_type, perimetre_id, est_actif, utilisateur_creation)
       VALUES ($1, $2, 'global', NULL, true, 'system')`,
      [userIdByEmail.get(email), String(roleRows[0]!.id)],
    );
  }
  return {
    adminId: userIdByEmail.get('admin@miznas.local')!,
    lecteurId: userIdByEmail.get('lecteur@miznas.local')!,
  };
}

async function seedDimensions(ds: DataSource): Promise<DimIds> {
  await ds.query(
    `INSERT INTO dim_temps
      ("date","annee","trimestre","mois","jour","jour_ouvre","est_fin_de_mois",
       "est_fin_de_trimestre","est_fin_d_annee","exercice_fiscal","libelle_mois")
     VALUES ('2026-04-01',2026,2,4,1,true,false,false,false,2026,'Avril')`,
  );
  await ds.query(
    `INSERT INTO dim_compte
      ("code_compte","libelle","classe","fk_compte_parent","niveau",
       "date_debut_validite","date_fin_validite","version_courante","est_actif","utilisateur_creation")
     VALUES ('611100','Salaires bruts',6,NULL,4,'2026-01-01',NULL,true,true,'system')`,
  );
  await ds.query(
    `INSERT INTO dim_structure
      ("code_structure","libelle","libelle_court","type_structure","niveau_hierarchique",
       "fk_structure_parent","code_pays","date_debut_validite","date_fin_validite",
       "version_courante","est_actif","utilisateur_creation")
     VALUES ('AG_TEST','Agence Test',NULL,'agence',1,NULL,NULL,'2026-01-01',NULL,true,true,'system')`,
  );
  const struct = (await ds.query(
    `SELECT id FROM dim_structure WHERE code_structure='AG_TEST'`,
  )) as Array<{ id: string | number }>;
  await ds.query(
    `INSERT INTO dim_centre_responsabilite
      ("code_cr","libelle","libelle_court","type_cr","fk_structure",
       "date_debut_validite","date_fin_validite","version_courante","est_actif","utilisateur_creation")
     VALUES ('CR_TEST','CR Test',NULL,'cdc',$1,'2026-01-01',NULL,true,true,'system')`,
    [String(struct[0]!.id)],
  );
  await ds.query(
    `INSERT INTO dim_ligne_metier
      ("code_ligne_metier","libelle","fk_ligne_metier_parent","niveau",
       "date_debut_validite","date_fin_validite","version_courante","est_actif","utilisateur_creation")
     VALUES ('RETAIL','Retail',NULL,1,'2026-01-01',NULL,true,true,'system')`,
  );
  await ds.query(
    `INSERT INTO dim_produit
      ("code_produit","libelle","type_produit","fk_produit_parent","niveau",
       "est_porteur_interets","date_debut_validite","date_fin_validite",
       "version_courante","est_actif","utilisateur_creation")
     VALUES ('DEPOT_VUE','Dépôts à vue','depot',NULL,1,false,'2026-01-01',NULL,true,true,'system')`,
  );
  await ds.query(
    `INSERT INTO dim_segment
      ("code_segment","libelle","categorie",
       "date_debut_validite","date_fin_validite","version_courante","est_actif","utilisateur_creation")
     VALUES ('PARTICULIER','Particuliers','particulier','2026-01-01',NULL,true,true,'system')`,
  );
  await ds.query(
    `INSERT INTO dim_devise
      ("code_iso","libelle","symbole","nb_decimales","est_devise_pivot","est_active","utilisateur_creation")
     VALUES ('XOF','Franc CFA','F CFA',0,true,true,'system')`,
  );
  await ds.query(
    `INSERT INTO dim_version
      ("code_version","libelle","type_version","exercice_fiscal","statut","utilisateur_creation")
     VALUES ('BUDGET_INITIAL_2026','Budget 2026','budget_initial',2026,'ouvert','system')`,
  );
  await ds.query(
    `INSERT INTO dim_scenario
      ("code_scenario","libelle","type_scenario","statut","utilisateur_creation")
     VALUES ('CENTRAL','Central','central','actif','system')`,
  );

  async function id(table: string, codeCol: string, code: string): Promise<string> {
    const r = (await ds.query(
      `SELECT id FROM ${table} WHERE ${codeCol} = $1`,
      [code],
    )) as Array<{ id: string | number }>;
    return String(r[0]!.id);
  }

  const tempsRow = (await ds.query(
    `SELECT id FROM dim_temps WHERE date = '2026-04-01'`,
  )) as Array<{ id: string | number }>;

  return {
    fkTemps: String(tempsRow[0]!.id),
    fkCompte: await id('dim_compte', 'code_compte', '611100'),
    fkStructure: await id('dim_structure', 'code_structure', 'AG_TEST'),
    fkCentre: await id('dim_centre_responsabilite', 'code_cr', 'CR_TEST'),
    fkLigneMetier: await id('dim_ligne_metier', 'code_ligne_metier', 'RETAIL'),
    fkProduit: await id('dim_produit', 'code_produit', 'DEPOT_VUE'),
    fkSegment: await id('dim_segment', 'code_segment', 'PARTICULIER'),
    fkDevise: await id('dim_devise', 'code_iso', 'XOF'),
    fkVersion: await id('dim_version', 'code_version', 'BUDGET_INITIAL_2026'),
    fkScenario: await id('dim_scenario', 'code_scenario', 'CENTRAL'),
  };
}

describe('FaitBudget (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let ids: SeedIds;
  let dimIds: DimIds;
  let adminToken: string;
  let lecteurToken: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'test-secret-fait-budget-e2e-min-32-chars-aaaaaaa';
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
        FaitBudgetModule,
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

    ids = await seedRolesUsers(dataSource);

    adminToken = await jwtService.signAsync({
      sub: ids.adminId,
      email: 'admin@miznas.local',
      jti: 'jti-admin-fb',
    });
    lecteurToken = await jwtService.signAsync({
      sub: ids.lecteurId,
      email: 'lecteur@miznas.local',
      jti: 'jti-lecteur-fb',
    });
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  beforeEach(async () => {
    await dataSource.query('DELETE FROM audit_log');
    await dataSource.query('DELETE FROM fait_budget');
    await dataSource.query('UPDATE dim_compte SET fk_compte_parent = NULL');
    await dataSource.query('DELETE FROM dim_compte');
    await dataSource.query('UPDATE dim_structure SET fk_structure_parent = NULL');
    await dataSource.query('DELETE FROM dim_centre_responsabilite');
    await dataSource.query('DELETE FROM dim_structure');
    await dataSource.query('UPDATE dim_ligne_metier SET fk_ligne_metier_parent = NULL');
    await dataSource.query('DELETE FROM dim_ligne_metier');
    await dataSource.query('UPDATE dim_produit SET fk_produit_parent = NULL');
    await dataSource.query('DELETE FROM dim_produit');
    await dataSource.query('DELETE FROM dim_segment');
    await dataSource.query('DELETE FROM dim_devise');
    await dataSource.query('DELETE FROM dim_version');
    await dataSource.query('DELETE FROM dim_scenario');
    await dataSource.query('DELETE FROM dim_temps');
    dimIds = await seedDimensions(dataSource);
  });

  function buildBody(overrides: Partial<DimIds> & { montantDevise?: number; montantFcfa?: number; tauxChangeApplique?: number } = {}) {
    return {
      fkTemps: dimIds.fkTemps,
      fkCompte: dimIds.fkCompte,
      fkStructure: dimIds.fkStructure,
      fkCentre: dimIds.fkCentre,
      fkLigneMetier: dimIds.fkLigneMetier,
      fkProduit: dimIds.fkProduit,
      fkSegment: dimIds.fkSegment,
      fkDevise: dimIds.fkDevise,
      fkVersion: dimIds.fkVersion,
      fkScenario: dimIds.fkScenario,
      montantDevise: 1000000,
      montantFcfa: 1000000,
      tauxChangeApplique: 1,
      ...overrides,
    };
  }

  // ─── Permissions

  it('GET sans token → 401', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/faits/budget')
      .expect(401);
  });

  it('LECTEUR : GET /budget → 200', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/faits/budget')
      .set('Authorization', `Bearer ${lecteurToken}`)
      .expect(200);
  });

  it('LECTEUR : POST /budget → 403', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/faits/budget')
      .set('Authorization', `Bearer ${lecteurToken}`)
      .send(buildBody())
      .expect(403);
  });

  it('LECTEUR : PATCH /budget/:id → 403', async () => {
    await request(app.getHttpServer())
      .patch('/api/v1/faits/budget/1')
      .set('Authorization', `Bearer ${lecteurToken}`)
      .send({ montantDevise: 2 })
      .expect(403);
  });

  it('LECTEUR : DELETE /budget/:id → 403', async () => {
    await request(app.getHttpServer())
      .delete('/api/v1/faits/budget/1')
      .set('Authorization', `Bearer ${lecteurToken}`)
      .expect(403);
  });

  // ─── CRUD nominal

  it('POST valide → 201 + audit CREATE success', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/faits/budget')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(buildBody())
      .expect(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.compte.code).toBe('611100');

    const audits = (await dataSource.query(
      `SELECT type_action, statut FROM audit_log WHERE entite_cible='fait_budget'`,
    )) as Array<{ type_action: string; statut: string }>;
    expect(
      audits.find(
        (a) => a.type_action === 'CREATE' && a.statut === 'success',
      ),
    ).toBeDefined();
  });

  it('POST avec FK invalide (fkVersion=999999) → 404', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/faits/budget')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(buildBody({ fkVersion: '999999' }))
      .expect(404);
  });

  it('POST grain doublon → 409', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/faits/budget')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(buildBody())
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/v1/faits/budget')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(buildBody())
      .expect(409);
  });

  it('PATCH mesures uniquement → 200', async () => {
    const c = await request(app.getHttpServer())
      .post('/api/v1/faits/budget')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(buildBody())
      .expect(201);
    const res = await request(app.getHttpServer())
      .patch(`/api/v1/faits/budget/${c.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ montantDevise: 1500000, montantFcfa: 1500000 })
      .expect(200);
    expect(res.body.montantDevise).toBe(1500000);
  });

  it('PATCH avec fkCompte dans le DTO → 422', async () => {
    const c = await request(app.getHttpServer())
      .post('/api/v1/faits/budget')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(buildBody())
      .expect(201);
    // forbidNonWhitelisted = true côté ValidationPipe → 400 Bad Request
    // car fkCompte n'est pas dans UpdateFaitBudgetDto. La défense
    // applicative au service (422) sert pour les cas où le pipe
    // serait désactivé. On vérifie juste qu'on rejette (4xx).
    const res = await request(app.getHttpServer())
      .patch(`/api/v1/faits/budget/${c.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ fkCompte: '999' });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it('DELETE si version=ouvert → 204', async () => {
    const c = await request(app.getHttpServer())
      .post('/api/v1/faits/budget')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(buildBody())
      .expect(201);
    await request(app.getHttpServer())
      .delete(`/api/v1/faits/budget/${c.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(204);
  });

  it('DELETE si version=soumis (forçage SQL) → 409', async () => {
    const c = await request(app.getHttpServer())
      .post('/api/v1/faits/budget')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(buildBody())
      .expect(201);
    await dataSource.query(
      `UPDATE dim_version SET statut='soumis' WHERE code_version='BUDGET_INITIAL_2026'`,
    );
    const res = await request(app.getHttpServer())
      .delete(`/api/v1/faits/budget/${c.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(409);
    expect(res.body.message).toMatch(/'soumis'/);
  });

  // ─── Filtres

  it('GET ?codeVersion=BUDGET_INITIAL_2026 → 1 résultat', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/faits/budget')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(buildBody())
      .expect(201);
    const res = await request(app.getHttpServer())
      .get('/api/v1/faits/budget')
      .query({ codeVersion: 'BUDGET_INITIAL_2026' })
      .set('Authorization', `Bearer ${lecteurToken}`)
      .expect(200);
    expect(res.body.total).toBe(1);
  });

  it('GET ?annee=2026&mois=4 → 1 résultat', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/faits/budget')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(buildBody())
      .expect(201);
    const res = await request(app.getHttpServer())
      .get('/api/v1/faits/budget')
      .query({ annee: 2026, mois: 4 })
      .set('Authorization', `Bearer ${lecteurToken}`)
      .expect(200);
    expect(res.body.total).toBe(1);
  });

  it('GET ?annee=2026&mois=12 → 0 résultats', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/faits/budget')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(buildBody())
      .expect(201);
    const res = await request(app.getHttpServer())
      .get('/api/v1/faits/budget')
      .query({ annee: 2026, mois: 12 })
      .set('Authorization', `Bearer ${lecteurToken}`)
      .expect(200);
    expect(res.body.total).toBe(0);
  });

  // ─── SCÉNARIO CRITIQUE — grain unique end-to-end

  it('SCÉNARIO CRITIQUE : POST grain → audit + GET par-grain + refus duplicate', async () => {
    // a) POST création
    const c = await request(app.getHttpServer())
      .post('/api/v1/faits/budget')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(buildBody())
      .expect(201);
    expect(c.body.compte.code).toBe('611100');
    expect(c.body.version.code).toBe('BUDGET_INITIAL_2026');

    // b) Audit log : 1 ligne CREATE fait_budget avec payload
    const audits = (await dataSource.query(
      `SELECT type_action, statut, payload_apres FROM audit_log
       WHERE entite_cible = 'fait_budget'`,
    )) as Array<{ type_action: string; statut: string; payload_apres: unknown }>;
    expect(audits).toHaveLength(1);
    expect(audits[0]!.type_action).toBe('CREATE');
    expect(audits[0]!.statut).toBe('success');
    expect(audits[0]!.payload_apres).toBeTruthy();

    // c) GET par grain → retrouve la ligne (passer uniquement les 10 FK)
    const grain = await request(app.getHttpServer())
      .get('/api/v1/faits/budget/par-grain')
      .query(dimIds)
      .set('Authorization', `Bearer ${lecteurToken}`)
      .expect(200);
    expect(grain.body.id).toBe(c.body.id);

    // d) Re-POST même grain → 409
    await request(app.getHttpServer())
      .post('/api/v1/faits/budget')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(buildBody())
      .expect(409);
  });
});
