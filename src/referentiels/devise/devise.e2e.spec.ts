/**
 * Tests d'intégration end-to-end des endpoints `/api/v1/referentiels/devises`.
 *
 * Particularité 2.2B : c'est le **premier usage en condition réelle**
 * du décorateur `@Auditable` (en place depuis le Lot 1.5). Les tests
 * vérifient :
 *  - la présence de la ligne `audit_log` après chaque opération sensible
 *    (POST / PATCH / DELETE)
 *  - le statut correct (`success` après 2xx, `failure` après exception
 *    métier remontée)
 *  - l'`utilisateur`, l'`entiteCible`, l'`idCible`
 *  - le `payloadApres` qui doit contenir le body envoyé (sanitizé)
 *
 * Note `payloadAvant` : l'intercepteur `AuditInterceptor` du Lot 1.5
 * pose `payloadAvant: null` systématiquement (la capture du « avant »
 * exigerait une lecture pré-handler). Donc on ne teste pas que
 * `payloadAvant` est rempli — on teste juste le pipeline.
 *
 * Limitations pg-mem documentées :
 *  - L'index unique partiel `uq_dim_devise_pivot` n'est pas matérialisé
 *    par `synchronize:true`. L'invariant pivot unique est ici porté par
 *    la première ligne de défense (service `ConflictException`). En
 *    Postgres réel, l'index partiel apporte une 2ᵉ ligne de défense
 *    contre les race conditions ; à valider en intégration Postgres.
 *  - pg-mem ne supporte pas `CROSS JOIN` (cf. `temps.e2e.spec.ts`),
 *    donc seed des bridges via sous-requêtes scalaires.
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
import { DeviseModule } from './devise.module';

interface AuditRow {
  type_action: string;
  entite_cible: string;
  id_cible: string | null;
  statut: string;
  utilisateur: string;
  payload_apres: unknown;
  commentaire: string | null;
}

async function seedAccessControl(ds: DataSource): Promise<{
  adminId: string;
  lecteurId: string;
  noPermsId: string;
  xofId: string;
}> {
  // Permissions
  for (const [code, libelle, mod] of [
    ['REFERENTIEL.LIRE', 'Lire les référentiels', 'REFERENTIEL'],
    ['REFERENTIEL.GERER', 'Gérer les référentiels', 'REFERENTIEL'],
  ]) {
    await ds.query(
      `INSERT INTO ref_permission (code_permission, libelle, module, utilisateur_creation)
       VALUES ($1, $2, $3, 'system')`,
      [code, libelle, mod],
    );
  }

  // Rôles
  for (const [code, libelle] of [
    ['ADMIN', 'Administrateur'],
    ['LECTEUR', 'Lecteur'],
  ]) {
    await ds.query(
      `INSERT INTO ref_role (code_role, libelle, est_actif, utilisateur_creation)
       VALUES ($1, $2, true, 'system')`,
      [code, libelle],
    );
  }

  // ADMIN ← REFERENTIEL.LIRE + REFERENTIEL.GERER ; LECTEUR ← REFERENTIEL.LIRE
  for (const [roleCode, permCode] of [
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
      [roleCode, permCode],
    );
  }

  // Utilisateurs
  await ds.query(
    `INSERT INTO "user" (email, mot_de_passe_hash, nom, prenom, est_actif, utilisateur_creation)
     VALUES
       ('admin@miznas.local',  'placeholder', 'Admin',  'MIZNAS', true, 'system'),
       ('lecteur@miznas.local','placeholder', 'Lecteur','MIZNAS', true, 'system'),
       ('noperms@miznas.local','placeholder', 'NoPerm', 'Test',   true, 'system')`,
  );

  const ids = (await ds.query(
    `SELECT email, id FROM "user" WHERE email IN ($1, $2, $3)`,
    ['admin@miznas.local', 'lecteur@miznas.local', 'noperms@miznas.local'],
  )) as Array<{ email: string; id: string }>;

  const idByEmail = new Map(ids.map((r) => [r.email, r.id]));

  // Affectations
  for (const [email, role] of [
    ['admin@miznas.local', 'ADMIN'],
    ['lecteur@miznas.local', 'LECTEUR'],
  ]) {
    const userId = idByEmail.get(email);
    const roleRows = (await ds.query(
      `SELECT id FROM ref_role WHERE code_role = $1`,
      [role],
    )) as Array<{ id: string }>;
    await ds.query(
      `INSERT INTO bridge_user_role (fk_user, fk_role, perimetre_type, perimetre_id, est_actif, utilisateur_creation)
       VALUES ($1, $2, 'global', NULL, true, 'system')`,
      [userId, roleRows[0]!.id],
    );
  }

  // XOF pivot — insert direct (l'invariant est porté par le service).
  await ds.query(
    `INSERT INTO dim_devise
       ("code_iso","libelle","symbole","nb_decimales",
        "est_devise_pivot","est_active","utilisateur_creation")
     VALUES ('XOF','Franc CFA BCEAO','F CFA',0,true,true,'system')`,
  );
  const xofRows = (await ds.query(
    `SELECT id FROM dim_devise WHERE code_iso = 'XOF'`,
  )) as Array<{ id: string }>;

  // pg-mem renvoie les bigint en number alors que le driver postgres
  // les renvoie en string. Coerce systématiquement pour rester fidèle
  // au contrat TypeORM (id: string) et permettre la comparaison directe
  // avec req.params.id (toujours string).
  return {
    adminId: String(idByEmail.get('admin@miznas.local')!),
    lecteurId: String(idByEmail.get('lecteur@miznas.local')!),
    noPermsId: String(idByEmail.get('noperms@miznas.local')!),
    xofId: String(xofRows[0]!.id),
  };
}

describe('Devise (e2e) — premier usage réel de @Auditable', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let adminToken: string;
  let lecteurToken: string;
  let xofId: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET =
      'test-secret-for-devise-e2e-min-32-chars-bbbbbbbbbb';
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
        DeviseModule,
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

    const ids = await seedAccessControl(dataSource);
    xofId = ids.xofId;

    adminToken = await jwtService.signAsync({
      sub: ids.adminId,
      email: 'admin@miznas.local',
      jti: 'jti-admin',
    });
    lecteurToken = await jwtService.signAsync({
      sub: ids.lecteurId,
      email: 'lecteur@miznas.local',
      jti: 'jti-lecteur',
    });
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  beforeEach(async () => {
    // Reset à un état connu : seul XOF persiste, audit_log purgé.
    await dataSource.query(`DELETE FROM dim_devise WHERE code_iso != 'XOF'`);
    await dataSource.query(`DELETE FROM audit_log`);
  });

  async function fetchAuditDevise(): Promise<AuditRow[]> {
    return (await dataSource.query(
      `SELECT type_action, entite_cible, id_cible, statut, utilisateur,
              payload_apres, commentaire
       FROM audit_log
       WHERE entite_cible = 'dim_devise'
       ORDER BY id ASC`,
    )) as AuditRow[];
  }

  // -- LECTURES (pas de @Auditable) ----------------------------------

  it('GET /api/v1/referentiels/devises with LECTEUR → 200', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/referentiels/devises')
      .set('Authorization', `Bearer ${lecteurToken}`)
      .expect(200);
    expect(res.body.total).toBeGreaterThanOrEqual(1);
    expect(
      res.body.items.find((d: { codeIso: string }) => d.codeIso === 'XOF'),
    ).toBeDefined();
  });

  it('GET /api/v1/referentiels/devises/pivot with LECTEUR → 200, codeIso=XOF', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/referentiels/devises/pivot')
      .set('Authorization', `Bearer ${lecteurToken}`)
      .expect(200);
    expect(res.body.codeIso).toBe('XOF');
    expect(res.body.estDevisePivot).toBe(true);
  });

  it('GET /api/v1/referentiels/devises without token → 401', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/referentiels/devises')
      .expect(401);
  });

  it('POST /api/v1/referentiels/devises with LECTEUR (no .GERER) → 403', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/referentiels/devises')
      .set('Authorization', `Bearer ${lecteurToken}`)
      .send({ codeIso: 'JPY', libelle: 'Yen' })
      .expect(403);
  });

  // -- POST avec @Auditable ------------------------------------------

  it('POST /devises with ADMIN, code "JPY" valid → 201 + 1 audit_log CREATE success', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/referentiels/devises')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        codeIso: 'JPY',
        libelle: 'Yen japonais',
        symbole: '¥',
        nbDecimales: 2,
      })
      .expect(201);
    expect(res.body.codeIso).toBe('JPY');

    const audits = await fetchAuditDevise();
    expect(audits).toHaveLength(1);
    expect(audits[0]!.type_action).toBe('CREATE');
    expect(audits[0]!.entite_cible).toBe('dim_devise');
    expect(audits[0]!.statut).toBe('success');
    expect(audits[0]!.utilisateur).toBe('admin@miznas.local');
    const payload = audits[0]!.payload_apres as {
      body?: { codeIso?: string };
    };
    expect(payload.body?.codeIso).toBe('JPY');
  });

  it('POST /devises with ADMIN, duplicate code "XOF" → 409 + 1 audit_log CREATE failure', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/referentiels/devises')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ codeIso: 'XOF', libelle: 'Duplicate' })
      .expect(409);

    const audits = await fetchAuditDevise();
    expect(audits).toHaveLength(1);
    expect(audits[0]!.type_action).toBe('CREATE');
    expect(audits[0]!.statut).toBe('failure');
    expect(audits[0]!.commentaire).toMatch(/existe déjà/);
  });

  it('POST /devises with ADMIN, second pivot attempt → 409 + 1 audit_log CREATE failure', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/referentiels/devises')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        codeIso: 'EUR',
        libelle: 'Euro',
        estDevisePivot: true,
      })
      .expect(409);

    const audits = await fetchAuditDevise();
    expect(audits).toHaveLength(1);
    expect(audits[0]!.type_action).toBe('CREATE');
    expect(audits[0]!.statut).toBe('failure');
    expect(audits[0]!.commentaire).toMatch(/Une devise pivot existe déjà/);
  });

  // -- PATCH avec @Auditable -----------------------------------------

  it('PATCH /devises/:xof estActive=false → 409 + 1 audit_log UPDATE failure', async () => {
    await request(app.getHttpServer())
      .patch(`/api/v1/referentiels/devises/${xofId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ estActive: false })
      .expect(409);

    const audits = await fetchAuditDevise();
    expect(audits).toHaveLength(1);
    expect(audits[0]!.type_action).toBe('UPDATE');
    expect(audits[0]!.statut).toBe('failure');
    expect(audits[0]!.id_cible).toBe(xofId);
    expect(audits[0]!.commentaire).toMatch(
      /Impossible de désactiver la devise pivot/,
    );
  });

  it('PATCH /devises/:jpy libelle change → 200 + 1 audit_log UPDATE success with body in payload_apres', async () => {
    // Insert JPY directly to avoid coupling tests.
    await dataSource.query(
      `INSERT INTO dim_devise ("code_iso","libelle","nb_decimales","est_devise_pivot","est_active","utilisateur_creation")
       VALUES ('JPY','Yen japonais',2,false,true,'system')`,
    );
    const jpy = (await dataSource.query(
      `SELECT id FROM dim_devise WHERE code_iso = 'JPY'`,
    )) as Array<{ id: string | number }>;
    const jpyId = String(jpy[0]!.id);

    const res = await request(app.getHttpServer())
      .patch(`/api/v1/referentiels/devises/${jpyId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ libelle: 'Yen (Japon)' })
      .expect(200);
    expect(res.body.libelle).toBe('Yen (Japon)');

    const audits = await fetchAuditDevise();
    expect(audits).toHaveLength(1);
    expect(audits[0]!.type_action).toBe('UPDATE');
    expect(audits[0]!.statut).toBe('success');
    expect(audits[0]!.id_cible).toBe(jpyId);
    const payload = audits[0]!.payload_apres as {
      body?: { libelle?: string };
    };
    expect(payload.body?.libelle).toBe('Yen (Japon)');
  });

  // -- DELETE avec @Auditable ----------------------------------------

  it('DELETE /devises/:jpy non-pivot → 204 + 1 audit_log DELETE success', async () => {
    await dataSource.query(
      `INSERT INTO dim_devise ("code_iso","libelle","nb_decimales","est_devise_pivot","est_active","utilisateur_creation")
       VALUES ('JPY','Yen japonais',2,false,true,'system')`,
    );
    const jpy = (await dataSource.query(
      `SELECT id FROM dim_devise WHERE code_iso = 'JPY'`,
    )) as Array<{ id: string | number }>;
    const jpyId = String(jpy[0]!.id);

    await request(app.getHttpServer())
      .delete(`/api/v1/referentiels/devises/${jpyId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(204);

    // Soft-delete : la ligne reste, est_active=false
    const after = (await dataSource.query(
      `SELECT est_active FROM dim_devise WHERE code_iso = 'JPY'`,
    )) as Array<{ est_active: boolean }>;
    expect(after[0]!.est_active).toBe(false);

    const audits = await fetchAuditDevise();
    expect(audits).toHaveLength(1);
    expect(audits[0]!.type_action).toBe('DELETE');
    expect(audits[0]!.statut).toBe('success');
    expect(audits[0]!.id_cible).toBe(jpyId);
  });

  it('DELETE /devises/:xof pivot → 409 + 1 audit_log DELETE failure', async () => {
    await request(app.getHttpServer())
      .delete(`/api/v1/referentiels/devises/${xofId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(409);

    const audits = await fetchAuditDevise();
    expect(audits).toHaveLength(1);
    expect(audits[0]!.type_action).toBe('DELETE');
    expect(audits[0]!.statut).toBe('failure');
    expect(audits[0]!.id_cible).toBe(xofId);
  });
});
