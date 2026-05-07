/**
 * Tests e2e UserPerimetresController (Lot 4.1.B.2).
 *
 * Couvre :
 *  - POST /admin/users/:userId/perimetres avec USER.GERER → 201
 *  - POST avec USER.LIRE seul → 403
 *  - DELETE soft → 204 + actif=false
 *  - GET /admin/users/:userId/perimetres avec filtres
 *  - GET /me/perimetres pour user connecté
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
import { CentreResponsabiliteModule } from '../../referentiels/centre-responsabilite/centre-responsabilite.module';
import { StructureModule } from '../../referentiels/structure/structure.module';
import { UsersModule } from '../users.module';

interface SeedIds {
  adminId: string;
  lecteurId: string;
  prepCivId: string;
  crCivId: string;
  crBfaId: string;
  structCivId: string;
}

async function seedRolesUsers(ds: DataSource): Promise<SeedIds> {
  for (const [code, libelle, mod] of [
    ['USER.LIRE', 'Lire users', 'USER'],
    ['USER.GERER', 'Gérer users', 'USER'],
  ]) {
    await ds.query(
      `INSERT INTO ref_permission (code_permission, libelle, module, utilisateur_creation)
       VALUES ($1,$2,$3,'system')`,
      [code, libelle, mod],
    );
  }
  for (const [code, libelle] of [
    ['ADMIN', 'Admin'],
    ['LECTEUR', 'Lecteur'],
  ]) {
    await ds.query(
      `INSERT INTO ref_role (code_role, libelle, est_actif, utilisateur_creation)
       VALUES ($1,$2,true,'system')`,
      [code, libelle],
    );
  }
  for (const [r, p] of [
    ['ADMIN', 'USER.LIRE'],
    ['ADMIN', 'USER.GERER'],
    ['LECTEUR', 'USER.LIRE'],
  ]) {
    await ds.query(
      `INSERT INTO bridge_role_permission (fk_role, fk_permission)
       VALUES (
         (SELECT id FROM ref_role WHERE code_role=$1),
         (SELECT id FROM ref_permission WHERE code_permission=$2)
       )`,
      [r, p],
    );
  }
  await ds.query(
    `INSERT INTO "user" (email, mot_de_passe_hash, nom, prenom, est_actif, utilisateur_creation)
     VALUES
       ('admin@miznas.local','h','Admin','X',true,'system'),
       ('lecteur@miznas.local','h','Lecteur','X',true,'system'),
       ('prep-civ@miznas.local','h','Aïcha','Diallo',true,'system')`,
  );
  const users = (await ds.query(
    `SELECT email, id FROM "user"`,
  )) as Array<{ email: string; id: string }>;
  const userIdByEmail = new Map(users.map((u) => [u.email, String(u.id)]));
  for (const [email, role] of [
    ['admin@miznas.local', 'ADMIN'],
    ['lecteur@miznas.local', 'LECTEUR'],
    ['prep-civ@miznas.local', 'LECTEUR'],
  ]) {
    const r = (await ds.query(
      `SELECT id FROM ref_role WHERE code_role=$1`,
      [role],
    )) as Array<{ id: string }>;
    await ds.query(
      `INSERT INTO bridge_user_role (fk_user, fk_role, perimetre_type, est_actif, utilisateur_creation)
       VALUES ($1, $2, 'global', true, 'system')`,
      [userIdByEmail.get(email), String(r[0]!.id)],
    );
  }

  // Structure + CR pour les cibles
  await ds.query(
    `INSERT INTO dim_structure
       (code_structure, libelle, type_structure, niveau_hierarchique,
        version_courante, est_actif, date_debut_validite, utilisateur_creation)
     VALUES ('CIV', 'Côte CIV', 'filiale', 2, true, true, '2026-01-01', 'system')`,
  );
  const sid = String(
    ((await ds.query(
      `SELECT id FROM dim_structure WHERE code_structure='CIV'`,
    )) as Array<{ id: string }>)[0]!.id,
  );
  await ds.query(
    `INSERT INTO dim_centre_responsabilite
       (code_cr, libelle, type_cr, fk_structure, version_courante,
        est_actif, date_debut_validite, utilisateur_creation)
     VALUES
       ('BR_CIV', 'Branche CIV', 'branche', $1, true, true, '2026-01-01', 'system'),
       ('BR_BFA', 'Branche BFA', 'branche', $1, true, true, '2026-01-01', 'system')`,
    [sid],
  );
  const crs = (await ds.query(
    `SELECT code_cr, id FROM dim_centre_responsabilite`,
  )) as Array<{ code_cr: string; id: string }>;

  return {
    adminId: userIdByEmail.get('admin@miznas.local')!,
    lecteurId: userIdByEmail.get('lecteur@miznas.local')!,
    prepCivId: userIdByEmail.get('prep-civ@miznas.local')!,
    crCivId: String(crs.find((c) => c.code_cr === 'BR_CIV')!.id),
    crBfaId: String(crs.find((c) => c.code_cr === 'BR_BFA')!.id),
    structCivId: sid,
  };
}

describe('UserPerimetresController (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let ids: SeedIds;
  let adminToken: string;
  let lecteurToken: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'test-secret-perimetres-e2e-min-32-chars-aaaaaaaa';
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
        StructureModule,
        CentreResponsabiliteModule,
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
    ids = await seedRolesUsers(dataSource);
    const jwt = app.get(JwtService);
    adminToken = await jwt.signAsync({
      sub: ids.adminId,
      email: 'admin@miznas.local',
      jti: 'jti-admin',
    });
    lecteurToken = await jwt.signAsync({
      sub: ids.lecteurId,
      email: 'lecteur@miznas.local',
      jti: 'jti-lecteur',
    });
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  beforeEach(async () => {
    await dataSource.query('DELETE FROM user_perimetres');
    await dataSource.query('DELETE FROM audit_log');
  });

  it('POST /admin/users/:id/perimetres sans USER.GERER → 403', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/admin/users/${ids.prepCivId}/perimetres`)
      .set('Authorization', `Bearer ${lecteurToken}`)
      .send({ cibleType: 'CR', cibleId: ids.crCivId })
      .expect(403);
  });

  it('POST /admin/users/:id/perimetres avec ADMIN crée + audit', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/admin/users/${ids.prepCivId}/perimetres`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ cibleType: 'CR', cibleId: ids.crCivId })
      .expect(201);
    expect(res.body.cibleType).toBe('CR');
    expect(res.body.actif).toBe(true);
    const audits = (await dataSource.query(
      `SELECT type_action FROM audit_log WHERE type_action='CREER_AFFECTATION'`,
    )) as Array<{ type_action: string }>;
    expect(audits).toHaveLength(1);
  });

  it('POST CR_SET avec 1 seul CR → 400', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/admin/users/${ids.prepCivId}/perimetres`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ cibleType: 'CR_SET', cibleCrIds: [ids.crCivId] })
      .expect(400);
  });

  it('DELETE soft → 204 + actif=false en base + audit', async () => {
    const create = await request(app.getHttpServer())
      .post(`/api/v1/admin/users/${ids.prepCivId}/perimetres`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ cibleType: 'CR', cibleId: ids.crCivId })
      .expect(201);
    const id = create.body.id as string;
    await request(app.getHttpServer())
      .delete(`/api/v1/admin/users/${ids.prepCivId}/perimetres/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(204);
    const row = (await dataSource.query(
      `SELECT actif FROM user_perimetres WHERE id=$1`,
      [id],
    )) as Array<{ actif: boolean }>;
    expect(row[0]!.actif).toBe(false);
    const audits = (await dataSource.query(
      `SELECT type_action FROM audit_log WHERE type_action='RETIRER_AFFECTATION'`,
    )) as Array<{ type_action: string }>;
    expect(audits).toHaveLength(1);
  });

  it('GET /admin/users/:id/perimetres filtre actif=true', async () => {
    // Crée 2, retire 1
    const a = await request(app.getHttpServer())
      .post(`/api/v1/admin/users/${ids.prepCivId}/perimetres`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ cibleType: 'CR', cibleId: ids.crCivId })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/admin/users/${ids.prepCivId}/perimetres`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ cibleType: 'CR', cibleId: ids.crBfaId })
      .expect(201);
    await request(app.getHttpServer())
      .delete(`/api/v1/admin/users/${ids.prepCivId}/perimetres/${a.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(204);

    const tous = await request(app.getHttpServer())
      .get(`/api/v1/admin/users/${ids.prepCivId}/perimetres`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(tous.body).toHaveLength(2);

    const actifs = await request(app.getHttpServer())
      .get(`/api/v1/admin/users/${ids.prepCivId}/perimetres`)
      .query({ actif: true })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(actifs.body).toHaveLength(1);
  });

  it('GET /me/perimetres ne renvoie que les miens et seulement les actifs', async () => {
    // Crée une affectation pour le lecteur ET pour le prepCiv
    await request(app.getHttpServer())
      .post(`/api/v1/admin/users/${ids.lecteurId}/perimetres`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ cibleType: 'CR', cibleId: ids.crCivId })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/admin/users/${ids.prepCivId}/perimetres`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ cibleType: 'CR', cibleId: ids.crBfaId })
      .expect(201);

    const me = await request(app.getHttpServer())
      .get('/api/v1/me/perimetres')
      .set('Authorization', `Bearer ${lecteurToken}`)
      .expect(200);
    expect(me.body).toHaveLength(1);
    expect(me.body[0].cibleId).toBe(ids.crCivId);
  });
});
