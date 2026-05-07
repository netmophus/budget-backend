/**
 * Tests e2e /api/v1/referentiels/versions.
 *
 * Couvre :
 *  - Permissions LECTEUR / ADMIN
 *  - CRUD avec @Auditable
 *  - Refus PATCH / DELETE quand statut != 'ouvert' (forcer le statut
 *    en SQL puis tenter PATCH/DELETE → 409 Conflict)
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
import { VersionModule } from './version.module';

interface SeedIds {
  adminId: string;
  lecteurId: string;
  preparateurId: string;
  controleurId: string;
  directeurId: string;
}

async function seedRolesUsers(ds: DataSource): Promise<SeedIds> {
  for (const [code, libelle, mod] of [
    ['REFERENTIEL.LIRE', 'Lire', 'REFERENTIEL'],
    ['REFERENTIEL.GERER', 'Gérer', 'REFERENTIEL'],
    // Lot 3.5 — workflow de validation budgétaire (3 permissions
    // distinctes par acteur).
    ['BUDGET.SOUMETTRE', 'Soumettre budget', 'BUDGET'],
    ['BUDGET.VALIDER', 'Valider budget', 'BUDGET'],
    ['BUDGET.PUBLIER', 'Publier budget', 'BUDGET'],
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
    ['PREPARATEUR', 'Préparateur budget'],
    ['CONTROLEUR', 'Contrôleur budget'],
    ['DIRECTEUR', 'Directeur'],
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
    // Workflow Lot 3.5 — un acteur = une permission.
    ['PREPARATEUR', 'REFERENTIEL.LIRE'],
    ['PREPARATEUR', 'BUDGET.SOUMETTRE'],
    ['CONTROLEUR', 'REFERENTIEL.LIRE'],
    ['CONTROLEUR', 'BUDGET.VALIDER'],
    ['DIRECTEUR', 'REFERENTIEL.LIRE'],
    ['DIRECTEUR', 'BUDGET.PUBLIER'],
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
       ('admin@miznas.local',       'placeholder', 'Admin',        'X', true, 'system'),
       ('lecteur@miznas.local',     'placeholder', 'Lecteur',      'X', true, 'system'),
       ('preparateur@miznas.local', 'placeholder', 'Préparateur',  'X', true, 'system'),
       ('controleur@miznas.local',  'placeholder', 'Contrôleur',   'X', true, 'system'),
       ('directeur@miznas.local',   'placeholder', 'Directeur',    'X', true, 'system')`,
  );
  const users = (await ds.query(
    `SELECT email, id FROM "user"`,
  )) as Array<{ email: string; id: string | number }>;
  const userIdByEmail = new Map(users.map((u) => [u.email, String(u.id)]));
  for (const [email, role] of [
    ['admin@miznas.local', 'ADMIN'],
    ['lecteur@miznas.local', 'LECTEUR'],
    ['preparateur@miznas.local', 'PREPARATEUR'],
    ['controleur@miznas.local', 'CONTROLEUR'],
    ['directeur@miznas.local', 'DIRECTEUR'],
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
    preparateurId: userIdByEmail.get('preparateur@miznas.local')!,
    controleurId: userIdByEmail.get('controleur@miznas.local')!,
    directeurId: userIdByEmail.get('directeur@miznas.local')!,
  };
}

describe('Version (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let ids: SeedIds;
  let adminToken: string;
  let lecteurToken: string;
  let preparateurToken: string;
  let controleurToken: string;
  let directeurToken: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'test-secret-version-e2e-min-32-chars-vvvvvvvvvv';
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
        VersionModule,
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
      jti: 'jti-admin-vr',
    });
    lecteurToken = await jwtService.signAsync({
      sub: ids.lecteurId,
      email: 'lecteur@miznas.local',
      jti: 'jti-lecteur-vr',
    });
    preparateurToken = await jwtService.signAsync({
      sub: ids.preparateurId,
      email: 'preparateur@miznas.local',
      jti: 'jti-preparateur-vr',
    });
    controleurToken = await jwtService.signAsync({
      sub: ids.controleurId,
      email: 'controleur@miznas.local',
      jti: 'jti-controleur-vr',
    });
    directeurToken = await jwtService.signAsync({
      sub: ids.directeurId,
      email: 'directeur@miznas.local',
      jti: 'jti-directeur-vr',
    });

    // Lot 3.5 — table fait_budget minimale (id + fk_version) pour
    // que VersionWorkflowService.soumettre puisse compter les lignes
    // sans charger l'entité FaitBudget complète.
    await dataSource.query(`
      CREATE TABLE fait_budget (
        id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
        fk_version bigint NOT NULL
      )
    `);

    // Lot 4.2-fix.A — table delegations minimale pour que
    // PermissionsService.getDelegationContextPour (appelé par les
    // 4 transitions du workflow) ne plante pas faute de table. Vide,
    // donc le helper retourne null = NATIF, pas d'effet sur l'audit.
    await dataSource.query(`
      CREATE TABLE delegations (
        id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
        fk_delegataire bigint NOT NULL,
        permissions text[] NOT NULL,
        actif boolean NOT NULL DEFAULT true,
        date_debut date NOT NULL,
        date_fin date NOT NULL
      )
    `);
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  beforeEach(async () => {
    await dataSource.query('DELETE FROM audit_log');
    await dataSource.query('DELETE FROM fait_budget');
    await dataSource.query('DELETE FROM dim_version');
  });

  it('GET /versions sans token → 401', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/referentiels/versions')
      .expect(401);
  });

  it('POST /versions avec LECTEUR → 403', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/referentiels/versions')
      .set('Authorization', `Bearer ${lecteurToken}`)
      .send({
        codeVersion: 'X',
        libelle: 'X',
        typeVersion: 'budget_initial',
        exerciceFiscal: 2026,
      })
      .expect(403);
  });

  it('POST valide → 201 + audit CREATE success + statut=ouvert', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/referentiels/versions')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        codeVersion: 'BUDGET_INITIAL_2027',
        libelle: 'Budget initial 2027',
        typeVersion: 'budget_initial',
        exerciceFiscal: 2027,
      })
      .expect(201);
    expect(res.body.codeVersion).toBe('BUDGET_INITIAL_2027');
    expect(res.body.statut).toBe('ouvert');

    const audits = (await dataSource.query(
      `SELECT type_action, statut FROM audit_log WHERE entite_cible = 'dim_version'`,
    )) as Array<{ type_action: string; statut: string }>;
    expect(
      audits.find(
        (a) => a.type_action === 'CREATE' && a.statut === 'success',
      ),
    ).toBeDefined();
  });

  it('POST avec doublon → 409', async () => {
    await dataSource.query(
      `INSERT INTO dim_version
        ("code_version","libelle","type_version","exercice_fiscal","statut","utilisateur_creation")
       VALUES ('BUDGET_INITIAL_2026','Budget','budget_initial',2026,'ouvert','system')`,
    );
    await request(app.getHttpServer())
      .post('/api/v1/referentiels/versions')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        codeVersion: 'BUDGET_INITIAL_2026',
        libelle: 'Dup',
        typeVersion: 'budget_initial',
        exerciceFiscal: 2026,
      })
      .expect(409);
  });

  it('GET / + filtre exerciceFiscal=2026 → 1 résultat', async () => {
    await dataSource.query(
      `INSERT INTO dim_version
        ("code_version","libelle","type_version","exercice_fiscal","statut","utilisateur_creation")
       VALUES
         ('BUDGET_INITIAL_2026','Budget 2026','budget_initial',2026,'ouvert','system'),
         ('BUDGET_INITIAL_2025','Budget 2025','budget_initial',2025,'gele','system')`,
    );
    const res = await request(app.getHttpServer())
      .get('/api/v1/referentiels/versions')
      .query({ exerciceFiscal: 2026 })
      .set('Authorization', `Bearer ${lecteurToken}`)
      .expect(200);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0].codeVersion).toBe('BUDGET_INITIAL_2026');
  });

  it('GET /par-code/:codeVersion → 200', async () => {
    await dataSource.query(
      `INSERT INTO dim_version
        ("code_version","libelle","type_version","exercice_fiscal","statut","utilisateur_creation")
       VALUES ('BUDGET_INITIAL_2026','Budget','budget_initial',2026,'ouvert','system')`,
    );
    const res = await request(app.getHttpServer())
      .get('/api/v1/referentiels/versions/par-code/BUDGET_INITIAL_2026')
      .set('Authorization', `Bearer ${lecteurToken}`)
      .expect(200);
    expect(res.body.codeVersion).toBe('BUDGET_INITIAL_2026');
  });

  // ─── SCÉNARIO CRITIQUE — refus modif statut != ouvert

  it('PATCH refusé (409) si statut=soumis (forçage SQL)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/referentiels/versions')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        codeVersion: 'BUDGET_INITIAL_2027',
        libelle: 'Budget 2027',
        typeVersion: 'budget_initial',
        exerciceFiscal: 2027,
      })
      .expect(201);
    const id: string = res.body.id;

    // Forcer le statut à 'soumis' en bypassant le service.
    await dataSource.query(
      `UPDATE dim_version SET statut='soumis' WHERE code_version='BUDGET_INITIAL_2027'`,
    );

    const patchRes = await request(app.getHttpServer())
      .patch(`/api/v1/referentiels/versions/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ libelle: 'Test refus' })
      .expect(409);
    expect(patchRes.body.message).toMatch(/'soumis'/);
  });

  it('DELETE refusé (409) si statut=valide', async () => {
    const ins = await dataSource.query(
      `INSERT INTO dim_version
        ("code_version","libelle","type_version","exercice_fiscal","statut","utilisateur_creation")
       VALUES ('BUDGET_INITIAL_2026','B','budget_initial',2026,'valide','system')
       RETURNING id`,
    );
    const id = String((ins as Array<{ id: string | number }>)[0]!.id);
    await request(app.getHttpServer())
      .delete(`/api/v1/referentiels/versions/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(409);
  });

  it('DELETE OK quand statut=ouvert → 204', async () => {
    const ins = await dataSource.query(
      `INSERT INTO dim_version
        ("code_version","libelle","type_version","exercice_fiscal","statut","utilisateur_creation")
       VALUES ('BUDGET_INITIAL_2026','B','budget_initial',2026,'ouvert','system')
       RETURNING id`,
    );
    const id = String((ins as Array<{ id: string | number }>)[0]!.id);
    await request(app.getHttpServer())
      .delete(`/api/v1/referentiels/versions/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(204);
  });

  // ─── Workflow Lot 3.5 — permissions et cycle complet ─────────────

  async function insertVersion(
    statut: 'ouvert' | 'soumis' | 'valide' | 'gele',
    code = 'BUDGET_INITIAL_2026',
  ): Promise<string> {
    const ins = (await dataSource.query(
      `INSERT INTO dim_version
        ("code_version","libelle","type_version","exercice_fiscal","statut","utilisateur_creation")
       VALUES ($1,'B','budget_initial',2026,$2,'system')
       RETURNING id`,
      [code, statut],
    )) as Array<{ id: string | number }>;
    return String(ins[0]!.id);
  }

  it('POST /:id/soumettre sans BUDGET.SOUMETTRE (lecteur) → 403', async () => {
    const id = await insertVersion('ouvert');
    await request(app.getHttpServer())
      .post(`/api/v1/referentiels/versions/${id}/soumettre`)
      .set('Authorization', `Bearer ${lecteurToken}`)
      .send({})
      .expect(403);
  });

  it('POST /:id/soumettre sur version vide → 422', async () => {
    const id = await insertVersion('ouvert');
    await request(app.getHttpServer())
      .post(`/api/v1/referentiels/versions/${id}/soumettre`)
      .set('Authorization', `Bearer ${preparateurToken}`)
      .send({ commentaire: 'Test' })
      .expect(422);
  });

  it('POST /:id/rejeter sans commentaire → 400 (DTO @IsNotEmpty)', async () => {
    const id = await insertVersion('soumis');
    await request(app.getHttpServer())
      .post(`/api/v1/referentiels/versions/${id}/rejeter`)
      .set('Authorization', `Bearer ${controleurToken}`)
      .send({})
      .expect(400);
  });

  it('POST /:id/publier depuis statut ouvert → 409', async () => {
    const id = await insertVersion('ouvert');
    await request(app.getHttpServer())
      .post(`/api/v1/referentiels/versions/${id}/publier`)
      .set('Authorization', `Bearer ${directeurToken}`)
      .send({})
      .expect(409);
  });

  it('cycle complet API : soumettre → valider → publier (3 audits)', async () => {
    const id = await insertVersion('ouvert', 'BUDGET_INITIAL_2027');
    await dataSource.query(
      `INSERT INTO fait_budget ("fk_version") VALUES ($1)`,
      [id],
    );

    const r1 = await request(app.getHttpServer())
      .post(`/api/v1/referentiels/versions/${id}/soumettre`)
      .set('Authorization', `Bearer ${preparateurToken}`)
      .send({ commentaire: 'À valider' })
      .expect(200);
    expect(r1.body.statut).toBe('soumis');

    const r2 = await request(app.getHttpServer())
      .post(`/api/v1/referentiels/versions/${id}/valider`)
      .set('Authorization', `Bearer ${controleurToken}`)
      .send({ commentaire: 'Conforme' })
      .expect(200);
    expect(r2.body.statut).toBe('valide');

    const r3 = await request(app.getHttpServer())
      .post(`/api/v1/referentiels/versions/${id}/publier`)
      .set('Authorization', `Bearer ${directeurToken}`)
      .send({ commentaire: 'Publication' })
      .expect(200);
    expect(r3.body.statut).toBe('gele');

    const audits = (await dataSource.query(
      `SELECT type_action FROM audit_log
        WHERE id_cible = $1 ORDER BY id ASC`,
      [String(id)],
    )) as Array<{ type_action: string }>;
    expect(audits.map((a) => a.type_action)).toEqual([
      'SOUMETTRE_BUDGET',
      'VALIDER_BUDGET',
      'PUBLIER_BUDGET',
    ]);
  });
});
