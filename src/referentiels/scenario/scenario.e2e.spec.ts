/**
 * Tests e2e /api/v1/referentiels/scenarios.
 * Couvre permissions, CRUD, et la transition d'archivage.
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
import { RolesModule } from '../../roles/roles.module';
import { UsersModule } from '../../users/users.module';
import { ScenarioModule } from './scenario.module';

interface SeedIds {
  adminId: string;
  lecteurId: string;
}

async function seedRolesUsers(ds: DataSource): Promise<SeedIds> {
  for (const [code, libelle] of [
    ['REFERENTIEL.LIRE', 'Lire'],
    ['REFERENTIEL.GERER', 'Gérer'],
  ]) {
    await ds.query(
      `INSERT INTO ref_permission (code_permission, libelle, module, utilisateur_creation)
       VALUES ($1, $2, 'REFERENTIEL', 'system')`,
      [code, libelle],
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
  for (const [r, p] of [
    ['ADMIN', 'REFERENTIEL.LIRE'],
    ['ADMIN', 'REFERENTIEL.GERER'],
    ['LECTEUR', 'REFERENTIEL.LIRE'],
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

describe('Scenario (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let ids: SeedIds;
  let adminToken: string;
  let lecteurToken: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'test-secret-scenario-e2e-min-32-chars-ssssssssss';
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
        ScenarioModule,
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
      jti: 'jti-admin-sc',
    });
    lecteurToken = await jwtService.signAsync({
      sub: ids.lecteurId,
      email: 'lecteur@miznas.local',
      jti: 'jti-lecteur-sc',
    });
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  beforeEach(async () => {
    await dataSource.query('DELETE FROM audit_log');
    await dataSource.query('DELETE FROM dim_scenario');
  });

  it('POST avec LECTEUR → 403', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/referentiels/scenarios')
      .set('Authorization', `Bearer ${lecteurToken}`)
      .send({ codeScenario: 'X', libelle: 'X', typeScenario: 'central' })
      .expect(403);
  });

  it('POST valide → 201 + audit CREATE + statut=actif', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/referentiels/scenarios')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        codeScenario: 'CENTRAL',
        libelle: 'Scénario central',
        typeScenario: 'central',
      })
      .expect(201);
    expect(res.body.statut).toBe('actif');

    const audits = (await dataSource.query(
      `SELECT type_action, statut FROM audit_log WHERE entite_cible = 'dim_scenario'`,
    )) as Array<{ type_action: string; statut: string }>;
    expect(
      audits.find(
        (a) => a.type_action === 'CREATE' && a.statut === 'success',
      ),
    ).toBeDefined();
  });

  it('POST avec doublon → 409', async () => {
    await dataSource.query(
      `INSERT INTO dim_scenario
        ("code_scenario","libelle","type_scenario","statut","utilisateur_creation")
       VALUES ('CENTRAL','C','central','actif','system')`,
    );
    await request(app.getHttpServer())
      .post('/api/v1/referentiels/scenarios')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ codeScenario: 'CENTRAL', libelle: 'D', typeScenario: 'central' })
      .expect(409);
  });

  it('GET /par-code/CENTRAL → 200', async () => {
    await dataSource.query(
      `INSERT INTO dim_scenario
        ("code_scenario","libelle","type_scenario","statut","utilisateur_creation")
       VALUES ('CENTRAL','C','central','actif','system')`,
    );
    const res = await request(app.getHttpServer())
      .get('/api/v1/referentiels/scenarios/par-code/CENTRAL')
      .set('Authorization', `Bearer ${lecteurToken}`)
      .expect(200);
    expect(res.body.codeScenario).toBe('CENTRAL');
  });

  // ─── SCÉNARIO CRITIQUE — archivage

  it('POST /:id/archiver → statut passe à archive, PATCH suivant → 409', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/referentiels/scenarios')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        codeScenario: 'OBSOLETE',
        libelle: 'À archiver',
        typeScenario: 'alternatif',
      })
      .expect(201);
    const id: string = res.body.id;

    const archived = await request(app.getHttpServer())
      .post(`/api/v1/referentiels/scenarios/${id}/archiver`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(archived.body.statut).toBe('archive');

    // PATCH suivant doit être refusé
    await request(app.getHttpServer())
      .patch(`/api/v1/referentiels/scenarios/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ libelle: 'Tentative' })
      .expect(409);

    // 2e archivage doit être refusé aussi (déjà archivé)
    await request(app.getHttpServer())
      .post(`/api/v1/referentiels/scenarios/${id}/archiver`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(409);

    // audit_log : 1 CREATE + 1 UPDATE (archivage compté UPDATE)
    const audits = (await dataSource.query(
      `SELECT type_action, statut FROM audit_log
       WHERE entite_cible = 'dim_scenario' ORDER BY date_action ASC`,
    )) as Array<{ type_action: string; statut: string }>;
    const successes = audits.filter((a) => a.statut === 'success');
    expect(successes.find((a) => a.type_action === 'CREATE')).toBeDefined();
    expect(successes.find((a) => a.type_action === 'UPDATE')).toBeDefined();
  });
});
