/**
 * Tests d'intégration end-to-end /api/v1/referentiels/cr.
 *
 * Couvre :
 *  - Permissions (LECTEUR / ADMIN)
 *  - CRUD CR avec @Auditable + sémantique 4-cas (modeMaj)
 *  - **SCÉNARIO CRITIQUE — relink en cascade (stratégie A) :**
 *    PATCH structure → nouvelle version SCD2 → CR.fkStructure
 *    repointé vers le nouvel id automatiquement, sans nouvelle
 *    version SCD2 du CR. Audit_log PATCH structure contient
 *    `crsRelinked >= 1` dans `payload_apres.response`.
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
import { StructureModule } from '../structure/structure.module';
import { CentreResponsabiliteModule } from './centre-responsabilite.module';

interface SeedIds {
  adminId: string;
  lecteurId: string;
  socId: string;
  brCivId: string;
  dirRetailId: string;
}

interface AuditRow {
  type_action: string;
  entite_cible: string;
  id_cible: string | null;
  statut: string;
  utilisateur: string;
  payload_apres: unknown;
  commentaire: string | null;
}

async function seedAll(ds: DataSource): Promise<SeedIds> {
  // Permissions / rôles / users
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

  // Structures (date passée pour permettre PATCH créant nouvelle version)
  const pastDate = new Date(Date.now() - 30 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const sIds = new Map<string, string>();
  async function insStruct(
    code: string,
    libelle: string,
    type: string,
    niveau: number,
    parentCode: string | null,
    pays: string | null,
  ): Promise<void> {
    const parentId =
      parentCode === null ? null : (sIds.get(parentCode) ?? null);
    await ds.query(
      `INSERT INTO dim_structure
        ("code_structure","libelle","type_structure","niveau_hierarchique",
         "fk_structure_parent","code_pays","date_debut_validite",
         "version_courante","est_actif","utilisateur_creation")
       VALUES ($1,$2,$3,$4,$5,$6,$7,true,true,'system')`,
      [code, libelle, type, niveau, parentId, pays, pastDate],
    );
    const rows = (await ds.query(
      `SELECT id FROM dim_structure WHERE code_structure = $1 AND version_courante = true`,
      [code],
    )) as Array<{ id: string | number }>;
    sIds.set(code, String(rows[0]!.id));
  }
  await insStruct('SOC', 'Société', 'entite_juridique', 1, null, null);
  await insStruct('BR_CIV', 'Branche CIV', 'branche', 2, 'SOC', 'CIV');
  await insStruct(
    'DIR_RETAIL',
    'Direction Retail',
    'direction',
    3,
    'BR_CIV',
    'CIV',
  );

  // CR rattaché à DIR_RETAIL
  await ds.query(
    `INSERT INTO dim_centre_responsabilite
      ("code_cr","libelle","type_cr","fk_structure",
       "date_debut_validite","date_fin_validite","version_courante",
       "est_actif","utilisateur_creation")
     VALUES ('CR_DIR_RETAIL','CR Direction Retail','cdp',$1,$2,NULL,true,true,'system')`,
    [sIds.get('DIR_RETAIL'), pastDate],
  );

  return {
    adminId: userIdByEmail.get('admin@miznas.local')!,
    lecteurId: userIdByEmail.get('lecteur@miznas.local')!,
    socId: sIds.get('SOC')!,
    brCivId: sIds.get('BR_CIV')!,
    dirRetailId: sIds.get('DIR_RETAIL')!,
  };
}

describe('CR (e2e) — 2ᵉ dimension SCD2 + relink stratégie A', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let ids: SeedIds;
  let adminToken: string;
  let lecteurToken: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET =
      'test-secret-cr-e2e-min-32-chars-dddddddddddddddddd';
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
    const jwtService = app.get(JwtService);

    ids = await seedAll(dataSource);

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
    await dataSource.query('DELETE FROM audit_log');

    // Purge complète puis reseed propre — c'est plus robuste que des
    // resets partiels qui se sont avérés fragiles entre tests
    // (DELETE+softClose dans un test rendait CR_DIR_RETAIL invisible
    // pour le test suivant).
    await dataSource.query('DELETE FROM dim_centre_responsabilite');
    // Casser la FK auto-référente avant DELETE FROM dim_structure.
    await dataSource.query(
      'UPDATE dim_structure SET fk_structure_parent = NULL',
    );
    await dataSource.query('DELETE FROM dim_structure');

    const pastDate = new Date(Date.now() - 30 * 86_400_000)
      .toISOString()
      .slice(0, 10);

    // Re-seed des 3 structures
    const structIds = new Map<string, string>();
    async function seedStruct(
      code: string,
      libelle: string,
      type: string,
      niveau: number,
      parentCode: string | null,
      pays: string | null,
    ) {
      const parentId =
        parentCode === null ? null : (structIds.get(parentCode) ?? null);
      await dataSource.query(
        `INSERT INTO dim_structure
          ("code_structure","libelle","type_structure","niveau_hierarchique",
           "fk_structure_parent","code_pays","date_debut_validite",
           "version_courante","est_actif","utilisateur_creation")
         VALUES ($1,$2,$3,$4,$5,$6,$7,true,true,'system')`,
        [code, libelle, type, niveau, parentId, pays, pastDate],
      );
      const r = (await dataSource.query(
        `SELECT id FROM dim_structure WHERE code_structure = $1 AND version_courante = true`,
        [code],
      )) as Array<{ id: string | number }>;
      structIds.set(code, String(r[0]!.id));
    }
    await seedStruct('SOC', 'Société', 'entite_juridique', 1, null, null);
    await seedStruct('BR_CIV', 'Branche CIV', 'branche', 2, 'SOC', 'CIV');
    await seedStruct(
      'DIR_RETAIL',
      'Direction Retail',
      'direction',
      3,
      'BR_CIV',
      'CIV',
    );

    ids.socId = structIds.get('SOC')!;
    ids.brCivId = structIds.get('BR_CIV')!;
    ids.dirRetailId = structIds.get('DIR_RETAIL')!;

    // Re-seed du CR de référence
    await dataSource.query(
      `INSERT INTO dim_centre_responsabilite
        ("code_cr","libelle","type_cr","fk_structure",
         "date_debut_validite","date_fin_validite","version_courante",
         "est_actif","utilisateur_creation")
       VALUES ('CR_DIR_RETAIL','CR Direction Retail','cdp',$1,$2,NULL,true,true,'system')`,
      [ids.dirRetailId, pastDate],
    );
  });

  // ─── Permissions

  it('GET /cr without token → 401', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/referentiels/cr')
      .expect(401);
  });

  it('GET /cr with LECTEUR → 200', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/referentiels/cr')
      .set('Authorization', `Bearer ${lecteurToken}`)
      .expect(200);
    expect(res.body.total).toBeGreaterThanOrEqual(1);
  });

  it('POST /cr with LECTEUR → 403', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/referentiels/cr')
      .set('Authorization', `Bearer ${lecteurToken}`)
      .send({
        codeCr: 'CR_X',
        libelle: 'X',
        typeCr: 'cdp',
        codeStructure: 'SOC',
      })
      .expect(403);
  });

  it('POST /cr with ADMIN, codeStructure valide → 201 + audit CREATE success', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/referentiels/cr')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        codeCr: 'CR_BR_CIV',
        libelle: 'CR Branche CIV',
        typeCr: 'cdc',
        codeStructure: 'BR_CIV',
      })
      .expect(201);
    expect(res.body.codeCr).toBe('CR_BR_CIV');
    expect(res.body.fkStructure).toBeDefined();

    const audits = (await dataSource.query(
      `SELECT type_action, statut FROM audit_log WHERE entite_cible = 'dim_centre_responsabilite'`,
    )) as Array<{ type_action: string; statut: string }>;
    expect(
      audits.find((a) => a.type_action === 'CREATE' && a.statut === 'success'),
    ).toBeDefined();
  });

  it('POST /cr with codeStructure inexistant → 422', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/referentiels/cr')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        codeCr: 'CR_X',
        libelle: 'X',
        typeCr: 'cdp',
        codeStructure: 'INEXISTANT',
      })
      .expect(422);
  });

  it('POST /cr with codeCr déjà courant → 409', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/referentiels/cr')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        codeCr: 'CR_DIR_RETAIL',
        libelle: 'Doublon',
        typeCr: 'cdp',
        codeStructure: 'DIR_RETAIL',
      })
      .expect(409);
  });

  it('PATCH /par-code/CR_DIR_RETAIL libelle → 200 + modeMaj=nouvelle_version', async () => {
    const res = await request(app.getHttpServer())
      .patch('/api/v1/referentiels/cr/par-code/CR_DIR_RETAIL')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ libelle: 'CR Direction Retail (V2)' })
      .expect(200);
    expect(res.body.modeMaj).toBe('nouvelle_version');
  });

  it('PATCH /par-code/CR_DIR_RETAIL estActif=false → 200 + modeMaj=in_place_est_actif', async () => {
    const res = await request(app.getHttpServer())
      .patch('/api/v1/referentiels/cr/par-code/CR_DIR_RETAIL')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ estActif: false })
      .expect(200);
    expect(res.body.modeMaj).toBe('in_place_est_actif');
  });

  it('GET /par-structure/DIR_RETAIL → 1 CR (CR_DIR_RETAIL)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/referentiels/cr/par-structure/DIR_RETAIL')
      .set('Authorization', `Bearer ${lecteurToken}`)
      .expect(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].codeCr).toBe('CR_DIR_RETAIL');
  });

  it('DELETE /par-code/CR_DIR_RETAIL → 204 + soft-closed', async () => {
    await request(app.getHttpServer())
      .delete('/api/v1/referentiels/cr/par-code/CR_DIR_RETAIL')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(204);
    const after = (await dataSource.query(
      `SELECT version_courante, est_actif FROM dim_centre_responsabilite WHERE code_cr = 'CR_DIR_RETAIL'`,
    )) as Array<{ version_courante: boolean; est_actif: boolean }>;
    expect(after[0]!.version_courante).toBe(false);
    expect(after[0]!.est_actif).toBe(false);
  });

  // ─── SCÉNARIO CRITIQUE — relink en cascade (stratégie A)

  it('PATCH structure DIR_RETAIL → nouvelle version + CR repointé automatiquement (relink stratégie A)', async () => {
    // État initial : CR_DIR_RETAIL.fk_structure = DIR_RETAIL.id (V1, 30j passés)
    const ancienId = ids.dirRetailId;

    // PATCH structure DIR_RETAIL libelle → nouvelle version SCD2
    const res = await request(app.getHttpServer())
      .patch('/api/v1/referentiels/structures/par-code/DIR_RETAIL')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ libelle: 'Direction Retail (rénovée)' })
      .expect(200);
    expect(res.body.modeMaj).toBe('nouvelle_version');
    expect(res.body.crsRelinked).toBe(1); // 1 CR repointé

    // dim_structure : 2 lignes pour DIR_RETAIL (V1 fermée, V2 courante)
    const versionsStruct = (await dataSource.query(
      `SELECT id, libelle, version_courante FROM dim_structure
       WHERE code_structure = 'DIR_RETAIL' ORDER BY date_debut_validite ASC`,
    )) as Array<{
      id: string | number;
      libelle: string;
      version_courante: boolean;
    }>;
    expect(versionsStruct).toHaveLength(2);
    const newStructIdRow = versionsStruct.find((v) => v.version_courante);
    const nouvelId = String(newStructIdRow!.id);
    expect(nouvelId).not.toBe(ancienId);

    // CR_DIR_RETAIL.fk_structure pointe maintenant vers le NOUVEL id
    const crRow = (await dataSource.query(
      `SELECT fk_structure FROM dim_centre_responsabilite
       WHERE code_cr = 'CR_DIR_RETAIL' AND version_courante = true`,
    )) as Array<{ fk_structure: string | number }>;
    expect(String(crRow[0]!.fk_structure)).toBe(nouvelId);

    // CR n'a PAS créé de nouvelle version SCD2 (toujours 1 ligne courante)
    const crVersions = (await dataSource.query(
      `SELECT COUNT(*)::int AS c FROM dim_centre_responsabilite
       WHERE code_cr = 'CR_DIR_RETAIL'`,
    )) as Array<{ c: number }>;
    expect(crVersions[0]!.c).toBe(1);

    // audit_log : UNE entrée UPDATE structure avec crsRelinked=1
    const audits = (await dataSource.query(
      `SELECT type_action, entite_cible, statut, payload_apres
       FROM audit_log WHERE entite_cible = 'dim_structure'`,
    )) as AuditRow[];
    const update = audits.find(
      (a) => a.type_action === 'UPDATE' && a.statut === 'success',
    );
    expect(update).toBeDefined();
    const payload = update!.payload_apres as {
      response?: { crsRelinked?: number };
    };
    expect(payload.response?.crsRelinked).toBe(1);
  });
});
