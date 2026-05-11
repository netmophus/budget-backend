/**
 * Tests e2e /api/v1/referentiels/segments.
 *
 * Pas de scénario relink (dim_segment est plat — cf.
 * `docs/modele-donnees.md` §3.7). On teste à la place :
 *  - PATCH PME change libelle (date passée) → nouvelle version SCD2,
 *    AUCUN relink (pas de hiérarchie).
 *  - Filtre par categorie.
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
import { SegmentModule } from './segment.module';

interface SeedIds {
  adminId: string;
  lecteurId: string;
}

interface AuditRow {
  type_action: string;
  entite_cible: string;
  statut: string;
  payload_apres: unknown;
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

async function seedSegments(ds: DataSource): Promise<void> {
  const past = new Date(Date.now() - 30 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const segs: Array<[string, string, string]> = [
    ['PARTICULIER', 'Particuliers', 'particulier'],
    ['PME', 'PME', 'pme'],
    ['GRANDE_ENTREPRISE', 'Grandes entreprises', 'grande_entreprise'],
  ];
  for (const [code, libelle, categorie] of segs) {
    await ds.query(
      `INSERT INTO dim_segment
        ("code_segment","libelle","categorie",
         "date_debut_validite","date_fin_validite",
         "version_courante","est_actif","utilisateur_creation")
       VALUES ($1,$2,$3,$4,NULL,true,true,'system')`,
      [code, libelle, categorie, past],
    );
  }
}

describe('Segment (e2e) — SCD2 plat (sans hiérarchie)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let ids: SeedIds;
  let adminToken: string;
  let lecteurToken: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'test-secret-segment-e2e-min-32-chars-zzzzzzzzzz';
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
        SegmentModule,
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
      jti: 'jti-admin-sg',
    });
    lecteurToken = await jwtService.signAsync({
      sub: ids.lecteurId,
      email: 'lecteur@miznas.local',
      jti: 'jti-lecteur-sg',
    });
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  beforeEach(async () => {
    await dataSource.query('DELETE FROM audit_log');
    await dataSource.query('DELETE FROM dim_segment');
    await seedSegments(dataSource);
  });

  it('GET /segments without token → 401', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/referentiels/segments')
      .expect(401);
  });

  it('GET /segments with LECTEUR → 200', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/referentiels/segments')
      .set('Authorization', `Bearer ${lecteurToken}`)
      .expect(200);
    expect(res.body.total).toBe(3);
  });

  it('GET /segments?categorie=pme → 1 segment', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/referentiels/segments')
      .query({ categorie: 'pme' })
      .set('Authorization', `Bearer ${lecteurToken}`)
      .expect(200);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0].codeSegment).toBe('PME');
  });

  it('POST /segments with LECTEUR → 403', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/referentiels/segments')
      .set('Authorization', `Bearer ${lecteurToken}`)
      .send({ codeSegment: 'X', libelle: 'X', categorie: 'particulier' })
      .expect(403);
  });

  it('POST valide → 201 + audit CREATE success', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/referentiels/segments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        codeSegment: 'INSTITUTIONNEL',
        libelle: 'Institutionnels',
        categorie: 'institutionnel',
      })
      .expect(201);
    expect(res.body.codeSegment).toBe('INSTITUTIONNEL');

    const audits = (await dataSource.query(
      `SELECT type_action, statut FROM audit_log WHERE entite_cible = 'dim_segment'`,
    )) as Array<{ type_action: string; statut: string }>;
    expect(
      audits.find((a) => a.type_action === 'CREATE' && a.statut === 'success'),
    ).toBeDefined();
  });

  it('POST avec doublon → 409', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/referentiels/segments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ codeSegment: 'PME', libelle: 'Dup', categorie: 'pme' })
      .expect(409);
  });

  it('POST avec categorie invalide → 400', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/referentiels/segments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        codeSegment: 'X',
        libelle: 'X',
        categorie: 'inconnu',
      })
      .expect(400);
  });

  it('PATCH /par-code/PME estActif=false → in_place_est_actif', async () => {
    const res = await request(app.getHttpServer())
      .patch('/api/v1/referentiels/segments/par-code/PME')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ estActif: false })
      .expect(200);
    expect(res.body.modeMaj).toBe('in_place_est_actif');
  });

  it('DELETE /par-code/PME → 204 + soft-close', async () => {
    await request(app.getHttpServer())
      .delete('/api/v1/referentiels/segments/par-code/PME')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(204);
    const after = (await dataSource.query(
      `SELECT version_courante, est_actif FROM dim_segment WHERE code_segment = 'PME'`,
    )) as Array<{ version_courante: boolean; est_actif: boolean }>;
    expect(after[0]!.version_courante).toBe(false);
    expect(after[0]!.est_actif).toBe(false);
  });

  // ─── PATCH change libelle → nouvelle version SCD2 (PAS de relink)

  it('PATCH /par-code/PME change libelle → nouvelle version SCD2, AUCUN relink (pas de hiérarchie)', async () => {
    const res = await request(app.getHttpServer())
      .patch('/api/v1/referentiels/segments/par-code/PME')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ libelle: 'PME (V2)' })
      .expect(200);
    expect(res.body.modeMaj).toBe('nouvelle_version');
    // dim_segment plate : pas de champ relink dans la réponse
    expect(res.body).not.toHaveProperty('segmentsEnfantsRelinked');

    const versions = (await dataSource.query(
      `SELECT libelle, version_courante FROM dim_segment
       WHERE code_segment = 'PME' ORDER BY date_debut_validite ASC`,
    )) as Array<{ libelle: string; version_courante: boolean }>;
    expect(versions).toHaveLength(2);
    expect(versions[0]!.version_courante).toBe(false);
    expect(versions[1]!.version_courante).toBe(true);
    expect(versions[1]!.libelle).toBe('PME (V2)');

    // audit_log UPDATE succès
    const audits = (await dataSource.query(
      `SELECT type_action, statut FROM audit_log
       WHERE entite_cible = 'dim_segment' AND type_action = 'UPDATE'`,
    )) as AuditRow[];
    expect(audits).toHaveLength(1);
    expect(audits[0]!.statut).toBe('success');
  });
});
