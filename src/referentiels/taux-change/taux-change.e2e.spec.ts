/**
 * Tests e2e /api/v1/referentiels/taux-change.
 *
 * Couvre :
 *  - Permissions LECTEUR / ADMIN
 *  - CRUD avec @Auditable
 *  - **GET /applicable** : date exacte, date entre 2 taux (retourne
 *    le plus récent antérieur), date avant tout taux (404), devise
 *    inconnue (404)
 *  - 422 si devise pivot, 422 si date inconnue, 409 doublon triplet
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
import { TauxChangeModule } from './taux-change.module';

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

async function seedDevisesAndTemps(ds: DataSource): Promise<void> {
  await ds.query(
    `INSERT INTO dim_devise
      ("code_iso","libelle","nb_decimales","est_devise_pivot","est_active","utilisateur_creation")
     VALUES
       ('XOF','Franc CFA',0,true,true,'system'),
       ('EUR','Euro',2,false,true,'system'),
       ('USD','Dollar',2,false,true,'system')`,
  );
  for (const [date, q, m, d] of [
    ['2026-01-15', 1, 1, 15],
    ['2026-03-31', 1, 3, 31],
    ['2026-04-15', 2, 4, 15],
    ['2026-06-30', 2, 6, 30],
  ] as const) {
    await ds.query(
      `INSERT INTO dim_temps
        ("date","annee","trimestre","mois","jour","jour_ouvre","est_fin_de_mois",
         "est_fin_de_trimestre","est_fin_d_annee","exercice_fiscal","libelle_mois")
       VALUES ($1,2026,$2,$3,$4,true,false,false,false,2026,'')`,
      [date, q, m, d],
    );
  }
}

describe('TauxChange (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let ids: SeedIds;
  let adminToken: string;
  let lecteurToken: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'test-secret-taux-e2e-min-32-chars-tttttttttttttt';
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
        TauxChangeModule,
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
      jti: 'jti-admin-tx',
    });
    lecteurToken = await jwtService.signAsync({
      sub: ids.lecteurId,
      email: 'lecteur@miznas.local',
      jti: 'jti-lecteur-tx',
    });
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  beforeEach(async () => {
    await dataSource.query('DELETE FROM audit_log');
    await dataSource.query('DELETE FROM ref_taux_change');
    await dataSource.query('DELETE FROM dim_devise');
    await dataSource.query('DELETE FROM dim_temps');
    await seedDevisesAndTemps(dataSource);
  });

  // ─── Permissions

  it('GET sans token → 401', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/referentiels/taux-change')
      .expect(401);
  });

  it('POST avec LECTEUR → 403', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/referentiels/taux-change')
      .set('Authorization', `Bearer ${lecteurToken}`)
      .send({
        codeDevise: 'EUR',
        date: '2026-03-31',
        tauxVersPivot: 655.957,
        typeTaux: 'cloture',
      })
      .expect(403);
  });

  // ─── CRUD nominal

  it('POST valide → 201 + audit CREATE success', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/referentiels/taux-change')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        codeDevise: 'EUR',
        date: '2026-03-31',
        tauxVersPivot: 655.957,
        typeTaux: 'cloture',
      })
      .expect(201);
    expect(res.body.fkDevise).toBeDefined();
    expect(res.body.devise.codeIso).toBe('EUR');

    const audits = (await dataSource.query(
      `SELECT type_action, statut FROM audit_log WHERE entite_cible = 'ref_taux_change'`,
    )) as Array<{ type_action: string; statut: string }>;
    expect(
      audits.find(
        (a) => a.type_action === 'CREATE' && a.statut === 'success',
      ),
    ).toBeDefined();
  });

  it('POST avec devise pivot (XOF) → 422', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/referentiels/taux-change')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        codeDevise: 'XOF',
        date: '2026-03-31',
        tauxVersPivot: 1,
        typeTaux: 'cloture',
      })
      .expect(422);
  });

  it('POST avec devise inconnue → 422', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/referentiels/taux-change')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        codeDevise: 'JPY',
        date: '2026-03-31',
        tauxVersPivot: 6,
        typeTaux: 'cloture',
      })
      .expect(422);
  });

  it('POST doublon triplet → 409', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/referentiels/taux-change')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        codeDevise: 'EUR',
        date: '2026-03-31',
        tauxVersPivot: 655.957,
        typeTaux: 'cloture',
      })
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/v1/referentiels/taux-change')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        codeDevise: 'EUR',
        date: '2026-03-31',
        tauxVersPivot: 656,
        typeTaux: 'cloture',
      })
      .expect(409);
  });

  // ─── SCÉNARIO CRITIQUE — GET /applicable

  describe('GET /applicable (résolution Lot 3.2)', () => {
    beforeEach(async () => {
      // Créer 2 taux EUR cloture : 2026-03-31 et 2026-06-30
      await request(app.getHttpServer())
        .post('/api/v1/referentiels/taux-change')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          codeDevise: 'EUR',
          date: '2026-03-31',
          tauxVersPivot: 655.957,
          typeTaux: 'cloture',
        })
        .expect(201);
      await request(app.getHttpServer())
        .post('/api/v1/referentiels/taux-change')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          codeDevise: 'EUR',
          date: '2026-06-30',
          tauxVersPivot: 656.1,
          typeTaux: 'cloture',
        })
        .expect(201);
    });

    it('date exacte 2026-03-31 → retourne le taux 655.957', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/referentiels/taux-change/applicable')
        .query({
          codeDevise: 'EUR',
          date: '2026-03-31',
          typeTaux: 'cloture',
        })
        .set('Authorization', `Bearer ${lecteurToken}`)
        .expect(200);
      expect(res.body.dateApplicable).toBe('2026-03-31');
      expect(parseFloat(res.body.tauxVersPivot)).toBeCloseTo(655.957, 5);
    });

    it('date entre 2 taux (2026-04-15) → retourne le taux du 31/03', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/referentiels/taux-change/applicable')
        .query({
          codeDevise: 'EUR',
          date: '2026-04-15',
          typeTaux: 'cloture',
        })
        .set('Authorization', `Bearer ${lecteurToken}`)
        .expect(200);
      expect(res.body.dateApplicable).toBe('2026-03-31');
      expect(parseFloat(res.body.tauxVersPivot)).toBeCloseTo(655.957, 5);
    });

    it('date avant tout taux (2026-01-15) → 404', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/referentiels/taux-change/applicable')
        .query({
          codeDevise: 'EUR',
          date: '2026-01-15',
          typeTaux: 'cloture',
        })
        .set('Authorization', `Bearer ${lecteurToken}`)
        .expect(404);
    });

    it('devise inconnue → 404', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/referentiels/taux-change/applicable')
        .query({
          codeDevise: 'JPY',
          date: '2026-04-15',
          typeTaux: 'cloture',
        })
        .set('Authorization', `Bearer ${lecteurToken}`)
        .expect(404);
    });
  });

  // ─── Liste + filtres

  it('GET ?codeDevise=EUR → filtre actif', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/referentiels/taux-change')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        codeDevise: 'EUR',
        date: '2026-03-31',
        tauxVersPivot: 655.957,
        typeTaux: 'cloture',
      });
    await request(app.getHttpServer())
      .post('/api/v1/referentiels/taux-change')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        codeDevise: 'USD',
        date: '2026-03-31',
        tauxVersPivot: 600,
        typeTaux: 'cloture',
      });
    const res = await request(app.getHttpServer())
      .get('/api/v1/referentiels/taux-change')
      .query({ codeDevise: 'EUR' })
      .set('Authorization', `Bearer ${lecteurToken}`)
      .expect(200);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0].devise.codeIso).toBe('EUR');
  });

  it('DELETE OK → 204', async () => {
    const create = await request(app.getHttpServer())
      .post('/api/v1/referentiels/taux-change')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        codeDevise: 'EUR',
        date: '2026-03-31',
        tauxVersPivot: 655.957,
        typeTaux: 'cloture',
      })
      .expect(201);
    await request(app.getHttpServer())
      .delete(`/api/v1/referentiels/taux-change/${create.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(204);
  });
});
