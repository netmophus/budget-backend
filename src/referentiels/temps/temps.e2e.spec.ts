/**
 * Tests d'intégration end-to-end des endpoints `/api/v1/referentiels/temps`.
 *
 * Stack de test :
 *  - pg-mem comme PostgreSQL en mémoire (cf.
 *    `common/services/scd2.service.spec.ts` pour les choix communs)
 *  - Nest TestingModule complet : AuthModule + UsersModule + RolesModule
 *    + AuditModule + TempsModule + global guards
 *  - JWT signé manuellement via le `JwtService` exposé par AuthModule
 *  - Seed minimal : 2 permissions, 1 rôle LECTEUR, 2 utilisateurs
 *    (un avec rôle, un sans), et le calendrier de janvier 2026 + 1er mai 2026.
 *
 * Couvre les scénarios listés au brief 2.2A §8.2 :
 *  - Token LECTEUR → 200 sur la liste filtrée
 *  - Pas de token → 401
 *  - Token sans permission REFERENTIEL.LIRE → 403
 *  - GET /par-date/2026-05-01 → jourOuvre=false
 *  - GET avec annee non numérique → 400 normalisé
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LoggerModule } from 'nestjs-pino';
import { DataType, newDb } from 'pg-mem';
import request from 'supertest';
import { DataSource, DataSourceOptions } from 'typeorm';

import { AuditModule } from '../../audit/audit.module';
import { AuthModule } from '../../auth/auth.module';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { AllExceptionsFilter } from '../../common/filters/all-exceptions.filter';
import { RolesModule } from '../../roles/roles.module';
import { UsersModule } from '../../users/users.module';
import { TempsModule } from './temps.module';

async function seedMinimal(ds: DataSource): Promise<{
  lecteurId: string;
  noPermsId: string;
}> {
  // 1. Permissions
  await ds.query(
    `INSERT INTO ref_permission (code_permission, libelle, module, utilisateur_creation)
     VALUES ($1, $2, $3, 'system')`,
    ['REFERENTIEL.LIRE', 'Lire les référentiels', 'REFERENTIEL'],
  );

  // 2. Rôle LECTEUR
  await ds.query(
    `INSERT INTO ref_role (code_role, libelle, est_actif, utilisateur_creation)
     VALUES ($1, $2, true, 'system')`,
    ['LECTEUR', 'Lecteur'],
  );

  // 3. Lien rôle ↔ permission (sous-requêtes scalaires car pg-mem ne
  //    supporte pas CROSS JOIN)
  await ds.query(
    `INSERT INTO bridge_role_permission (fk_role, fk_permission)
     VALUES (
       (SELECT id FROM ref_role WHERE code_role = 'LECTEUR'),
       (SELECT id FROM ref_permission WHERE code_permission = 'REFERENTIEL.LIRE')
     )`,
  );

  // 4. Utilisateurs
  await ds.query(
    `INSERT INTO "user" (email, mot_de_passe_hash, nom, prenom, est_actif, utilisateur_creation)
     VALUES ($1, 'placeholder', 'Lecteur', 'Test', true, 'system'),
            ($2, 'placeholder', 'NoPerm',  'Test', true, 'system')`,
    ['lecteur@test.local', 'noperms@test.local'],
  );

  const lecteur = (await ds.query(
    `SELECT id FROM "user" WHERE email = $1`,
    ['lecteur@test.local'],
  )) as Array<{ id: string }>;
  const noPerms = (await ds.query(
    `SELECT id FROM "user" WHERE email = $1`,
    ['noperms@test.local'],
  )) as Array<{ id: string }>;

  // 5. Affectation rôle global au lecteur uniquement (sous-requête
  //    scalaire pour le rôle, pour rester compatible pg-mem)
  const lecteurRole = (await ds.query(
    `SELECT id FROM ref_role WHERE code_role = 'LECTEUR'`,
  )) as Array<{ id: string }>;
  await ds.query(
    `INSERT INTO bridge_user_role (fk_user, fk_role, perimetre_type, perimetre_id, est_actif, utilisateur_creation)
     VALUES ($1, $2, 'global', NULL, true, 'system')`,
    [lecteur[0]!.id, lecteurRole[0]!.id],
  );

  // 6. dim_temps : janvier 2026 (31 jours) + 1er mai 2026 (férié)
  for (let day = 1; day <= 31; day++) {
    const dd = day < 10 ? `0${day}` : String(day);
    const date = `2026-01-${dd}`;
    const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
    const ouvre = dow !== 0 && dow !== 6 && !(day === 1);
    await ds.query(
      `INSERT INTO dim_temps
        ("date","annee","trimestre","mois","jour","semaine_iso",
         "jour_ouvre","est_fin_de_mois","est_fin_de_trimestre",
         "est_fin_d_annee","exercice_fiscal","libelle_mois")
       VALUES ($1,2026,1,1,$2,1,$3,false,false,false,2026,'Janv. 2026')`,
      [date, day, ouvre],
    );
  }
  await ds.query(
    `INSERT INTO dim_temps
      ("date","annee","trimestre","mois","jour","semaine_iso",
       "jour_ouvre","est_fin_de_mois","est_fin_de_trimestre",
       "est_fin_d_annee","exercice_fiscal","libelle_mois")
     VALUES ('2026-05-01',2026,2,5,1,18,false,false,false,false,2026,'Mai 2026')`,
  );

  return {
    lecteurId: lecteur[0]!.id,
    noPermsId: noPerms[0]!.id,
  };
}

describe('Temps (e2e)', () => {
  let app: INestApplication;
  let lecteurAccessToken: string;
  let noPermsAccessToken: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET =
      'test-secret-for-temps-e2e-min-32-chars-aaaaaaaaaa';
    process.env.JWT_ACCESS_EXPIRES_IN = '15m';
    process.env.JWT_REFRESH_EXPIRES_IN = '7d';
    process.env.BCRYPT_ROUNDS = '4';
    // Empêche le DataSource standalone (data-source.ts) de tenter de
    // se connecter à un vrai Postgres si jamais il est importé.
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
            if (!options) {
              throw new Error('TypeOrm options required for pg-mem adapter');
            }
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
      ],
      providers: [
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: PermissionsGuard },
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

    const dataSource = app.get(DataSource);
    const jwtService = app.get(JwtService);

    const ids = await seedMinimal(dataSource);

    lecteurAccessToken = await jwtService.signAsync({
      sub: ids.lecteurId,
      email: 'lecteur@test.local',
      jti: 'test-jti-lecteur',
    });
    noPermsAccessToken = await jwtService.signAsync({
      sub: ids.noPermsId,
      email: 'noperms@test.local',
      jti: 'test-jti-noperms',
    });
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('GET /api/v1/referentiels/temps without token → 401', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/referentiels/temps')
      .expect(401);
  });

  it('GET /api/v1/referentiels/temps?annee=2026&mois=1 with LECTEUR → 200 (31 jours)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/referentiels/temps')
      .query({ annee: 2026, mois: 1 })
      .set('Authorization', `Bearer ${lecteurAccessToken}`)
      .expect(200);

    expect(res.body.total).toBe(31);
    expect(res.body.items[0].date).toBe('2026-01-01');
    expect(res.body.items.length).toBe(31);
  });

  it('GET /api/v1/referentiels/temps with user lacking REFERENTIEL.LIRE → 403', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/referentiels/temps')
      .set('Authorization', `Bearer ${noPermsAccessToken}`)
      .expect(403);
  });

  it('GET /api/v1/referentiels/temps/par-date/2026-05-01 → 1er mai férié, jourOuvre=false', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/referentiels/temps/par-date/2026-05-01')
      .set('Authorization', `Bearer ${lecteurAccessToken}`)
      .expect(200);

    expect(res.body.date).toBe('2026-05-01');
    expect(res.body.jourOuvre).toBe(false);
    expect(res.body.libelleMois).toBe('Mai 2026');
  });

  it('GET /api/v1/referentiels/temps with non-numeric annee → 400 normalised body', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/referentiels/temps')
      .query({ annee: 'invalid' })
      .set('Authorization', `Bearer ${lecteurAccessToken}`)
      .expect(400);

    expect(res.body).toHaveProperty('statusCode', 400);
    expect(res.body).toHaveProperty('errorCode');
    expect(res.body).toHaveProperty('path');
  });
});
