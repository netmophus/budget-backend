/**
 * Tests e2e /api/v1/referentiels/lignes-metier.
 *
 * Couvre :
 *  - Permissions LECTEUR / ADMIN
 *  - CRUD avec @Auditable + sémantique 4-cas
 *  - **SCÉNARIO CRITIQUE — relink auto-référence stratégie A** :
 *    PATCH ligne métier parent → nouvelle version SCD2 → enfants
 *    repointés vers le nouvel id automatiquement, sans nouvelle
 *    version SCD2 des enfants. audit_log atteste
 *    `lignesMetierEnfantsRelinked >= 1` dans `payload_apres.response`.
 *
 * Symétrique à compte.e2e.spec.ts.
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
import { LigneMetierModule } from './ligne-metier.module';

interface SeedIds {
  adminId: string;
  lecteurId: string;
  idRetail: string;
  idCorporate: string;
  idRetailPart: string;
  idRetailPro: string;
}

interface AuditRow {
  type_action: string;
  entite_cible: string;
  statut: string;
  payload_apres: unknown;
}

async function seedAll(ds: DataSource): Promise<SeedIds> {
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

  const past = new Date(Date.now() - 30 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const ids = new Map<string, string>();
  async function ins(
    code: string,
    libelle: string,
    niveau: number,
    parentCode: string | null,
  ) {
    const parentId = parentCode === null ? null : ids.get(parentCode) ?? null;
    await ds.query(
      `INSERT INTO dim_ligne_metier
        ("code_ligne_metier","libelle","fk_ligne_metier_parent","niveau",
         "date_debut_validite","date_fin_validite",
         "version_courante","est_actif","utilisateur_creation")
       VALUES ($1,$2,$3,$4,$5,NULL,true,true,'system')`,
      [code, libelle, parentId, niveau, past],
    );
    const r = (await ds.query(
      `SELECT id FROM dim_ligne_metier WHERE code_ligne_metier = $1 AND version_courante = true`,
      [code],
    )) as Array<{ id: string | number }>;
    ids.set(code, String(r[0]!.id));
  }
  await ins('RETAIL', 'Banque de détail', 1, null);
  await ins('CORPORATE', "Banque d'entreprise", 1, null);
  await ins('RETAIL_PARTICULIERS', 'Particuliers', 2, 'RETAIL');
  await ins('RETAIL_PRO', 'Professionnels', 2, 'RETAIL');

  return {
    adminId: userIdByEmail.get('admin@miznas.local')!,
    lecteurId: userIdByEmail.get('lecteur@miznas.local')!,
    idRetail: ids.get('RETAIL')!,
    idCorporate: ids.get('CORPORATE')!,
    idRetailPart: ids.get('RETAIL_PARTICULIERS')!,
    idRetailPro: ids.get('RETAIL_PRO')!,
  };
}

describe('LigneMetier (e2e) — SCD2 hiérarchique + relink auto-référence stratégie A', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let ids: SeedIds;
  let adminToken: string;
  let lecteurToken: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'test-secret-ligne-metier-e2e-min-32-chars-xxxxxx';
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
        LigneMetierModule,
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
      jti: 'jti-admin-lm',
    });
    lecteurToken = await jwtService.signAsync({
      sub: ids.lecteurId,
      email: 'lecteur@miznas.local',
      jti: 'jti-lecteur-lm',
    });
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  beforeEach(async () => {
    await dataSource.query('DELETE FROM audit_log');
    await dataSource.query(
      'UPDATE dim_ligne_metier SET fk_ligne_metier_parent = NULL',
    );
    await dataSource.query('DELETE FROM dim_ligne_metier');

    const past = new Date(Date.now() - 30 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const localIds = new Map<string, string>();
    async function ins(
      code: string,
      libelle: string,
      niveau: number,
      parentCode: string | null,
    ) {
      const parentId =
        parentCode === null ? null : localIds.get(parentCode) ?? null;
      await dataSource.query(
        `INSERT INTO dim_ligne_metier
          ("code_ligne_metier","libelle","fk_ligne_metier_parent","niveau",
           "date_debut_validite","date_fin_validite",
           "version_courante","est_actif","utilisateur_creation")
         VALUES ($1,$2,$3,$4,$5,NULL,true,true,'system')`,
        [code, libelle, parentId, niveau, past],
      );
      const r = (await dataSource.query(
        `SELECT id FROM dim_ligne_metier WHERE code_ligne_metier = $1 AND version_courante = true`,
        [code],
      )) as Array<{ id: string | number }>;
      localIds.set(code, String(r[0]!.id));
    }
    await ins('RETAIL', 'Banque de détail', 1, null);
    await ins('CORPORATE', "Banque d'entreprise", 1, null);
    await ins('RETAIL_PARTICULIERS', 'Particuliers', 2, 'RETAIL');
    await ins('RETAIL_PRO', 'Professionnels', 2, 'RETAIL');

    ids.idRetail = localIds.get('RETAIL')!;
    ids.idCorporate = localIds.get('CORPORATE')!;
    ids.idRetailPart = localIds.get('RETAIL_PARTICULIERS')!;
    ids.idRetailPro = localIds.get('RETAIL_PRO')!;
  });

  // ─── Permissions

  it('GET /lignes-metier without token → 401', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/referentiels/lignes-metier')
      .expect(401);
  });

  it('GET /lignes-metier with LECTEUR → 200', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/referentiels/lignes-metier')
      .set('Authorization', `Bearer ${lecteurToken}`)
      .expect(200);
    expect(res.body.total).toBeGreaterThanOrEqual(4);
  });

  it('POST /lignes-metier with LECTEUR → 403', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/referentiels/lignes-metier')
      .set('Authorization', `Bearer ${lecteurToken}`)
      .send({
        codeLigneMetier: 'NEW',
        libelle: 'X',
        niveau: 2,
        codeLigneMetierParent: 'RETAIL',
      })
      .expect(403);
  });

  // ─── CRUD nominal

  it('POST /lignes-metier valide → 201 + audit CREATE success', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/referentiels/lignes-metier')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        codeLigneMetier: 'TRESORERIE',
        libelle: 'Trésorerie et marchés',
        niveau: 1,
      })
      .expect(201);
    expect(res.body.codeLigneMetier).toBe('TRESORERIE');

    const audits = (await dataSource.query(
      `SELECT type_action, statut FROM audit_log WHERE entite_cible = 'dim_ligne_metier'`,
    )) as Array<{ type_action: string; statut: string }>;
    expect(
      audits.find(
        (a) => a.type_action === 'CREATE' && a.statut === 'success',
      ),
    ).toBeDefined();
  });

  it('POST avec code existant → 409', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/referentiels/lignes-metier')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        codeLigneMetier: 'RETAIL',
        libelle: 'Doublon',
        niveau: 1,
      })
      .expect(409);
  });

  it('POST avec parent inexistant → 422', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/referentiels/lignes-metier')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        codeLigneMetier: 'X',
        libelle: 'X',
        niveau: 2,
        codeLigneMetierParent: 'INEXISTANT',
      })
      .expect(422);
  });

  it('GET /:idRetail/descendants → toute la sous-arborescence RETAIL', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/referentiels/lignes-metier/${ids.idRetail}/descendants`)
      .set('Authorization', `Bearer ${lecteurToken}`)
      .expect(200);
    expect(res.body.length).toBe(2);
  });

  it('PATCH /par-code/RETAIL_PARTICULIERS estActif=false → in-place', async () => {
    const res = await request(app.getHttpServer())
      .patch('/api/v1/referentiels/lignes-metier/par-code/RETAIL_PARTICULIERS')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ estActif: false })
      .expect(200);
    expect(res.body.modeMaj).toBe('in_place_est_actif');
  });

  it('DELETE /par-code/RETAIL_PARTICULIERS (feuille) → 204 + soft-close', async () => {
    await request(app.getHttpServer())
      .delete('/api/v1/referentiels/lignes-metier/par-code/RETAIL_PARTICULIERS')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(204);
    const after = (await dataSource.query(
      `SELECT version_courante, est_actif FROM dim_ligne_metier WHERE code_ligne_metier = 'RETAIL_PARTICULIERS'`,
    )) as Array<{ version_courante: boolean; est_actif: boolean }>;
    expect(after[0]!.version_courante).toBe(false);
    expect(after[0]!.est_actif).toBe(false);
  });

  it('DELETE /par-code/RETAIL (a des enfants) → 409', async () => {
    await request(app.getHttpServer())
      .delete('/api/v1/referentiels/lignes-metier/par-code/RETAIL')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(409);
  });

  // ─── SCÉNARIO CRITIQUE — relink auto-référence

  it('PATCH /par-code/RETAIL change libelle → nouvelle version SCD2 + 2 enfants relinkés', async () => {
    const ancienId = ids.idRetail;

    const res = await request(app.getHttpServer())
      .patch('/api/v1/referentiels/lignes-metier/par-code/RETAIL')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ libelle: 'Banque de détail (V2)' })
      .expect(200);
    expect(res.body.modeMaj).toBe('nouvelle_version');
    expect(res.body.lignesMetierEnfantsRelinked).toBe(2);

    // 2 lignes pour RETAIL (V1 fermée, V2 courante)
    const versions = (await dataSource.query(
      `SELECT id, libelle, version_courante FROM dim_ligne_metier
       WHERE code_ligne_metier = 'RETAIL' ORDER BY date_debut_validite ASC`,
    )) as Array<{
      id: string | number;
      libelle: string;
      version_courante: boolean;
    }>;
    expect(versions).toHaveLength(2);
    const newId = String(versions.find((v) => v.version_courante)!.id);
    expect(newId).not.toBe(ancienId);

    // Les 2 enfants pointent vers le NOUVEL id de RETAIL
    const enfants = (await dataSource.query(
      `SELECT code_ligne_metier, fk_ligne_metier_parent FROM dim_ligne_metier
       WHERE code_ligne_metier IN ('RETAIL_PARTICULIERS', 'RETAIL_PRO') AND version_courante = true
       ORDER BY code_ligne_metier`,
    )) as Array<{
      code_ligne_metier: string;
      fk_ligne_metier_parent: string | number;
    }>;
    expect(enfants).toHaveLength(2);
    for (const e of enfants) {
      expect(String(e.fk_ligne_metier_parent)).toBe(newId);
    }

    // Les enfants n'ont PAS créé de nouvelle version (1 ligne par code)
    const counts = (await dataSource.query(
      `SELECT code_ligne_metier, COUNT(*)::int AS c FROM dim_ligne_metier
       WHERE code_ligne_metier IN ('RETAIL_PARTICULIERS', 'RETAIL_PRO') GROUP BY code_ligne_metier`,
    )) as Array<{ code_ligne_metier: string; c: number }>;
    for (const r of counts) {
      expect(r.c).toBe(1);
    }

    // audit_log : UPDATE success avec lignesMetierEnfantsRelinked=2
    const audits = (await dataSource.query(
      `SELECT type_action, statut, payload_apres FROM audit_log
       WHERE entite_cible = 'dim_ligne_metier' AND type_action = 'UPDATE'`,
    )) as AuditRow[];
    expect(audits).toHaveLength(1);
    const payload = audits[0]!.payload_apres as {
      response?: { lignesMetierEnfantsRelinked?: number };
    };
    expect(payload.response?.lignesMetierEnfantsRelinked).toBe(2);
  });
});
