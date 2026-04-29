/**
 * Tests e2e /api/v1/referentiels/produits.
 *
 * Inclut le SCÉNARIO CRITIQUE — relink auto-référence stratégie A :
 * PATCH DEPOT_GRP change libelle → nouvelle version + 3 enfants
 * (DEPOT_VUE, DEPOT_TERME, DEPOT_EPARGNE) repointés vers nouvel id.
 *
 * Symétrique à compte.e2e.spec.ts et ligne-metier.e2e.spec.ts.
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
import { ProduitModule } from './produit.module';

interface SeedIds {
  adminId: string;
  lecteurId: string;
  idCreditGrp: string;
  idDepotGrp: string;
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

  return {
    adminId: userIdByEmail.get('admin@miznas.local')!,
    lecteurId: userIdByEmail.get('lecteur@miznas.local')!,
    idCreditGrp: '',
    idDepotGrp: '',
  };
}

async function seedProduits(ds: DataSource): Promise<{
  idCreditGrp: string;
  idDepotGrp: string;
}> {
  const past = new Date(Date.now() - 30 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const ids = new Map<string, string>();
  async function ins(
    code: string,
    libelle: string,
    type: 'credit' | 'depot' | 'service' | 'marche' | 'autre',
    niveau: number,
    parentCode: string | null,
    epi = false,
  ) {
    const parentId = parentCode === null ? null : ids.get(parentCode) ?? null;
    await ds.query(
      `INSERT INTO dim_produit
        ("code_produit","libelle","type_produit","fk_produit_parent","niveau",
         "est_porteur_interets","date_debut_validite","date_fin_validite",
         "version_courante","est_actif","utilisateur_creation")
       VALUES ($1,$2,$3,$4,$5,$6,$7,NULL,true,true,'system')`,
      [code, libelle, type, parentId, niveau, epi, past],
    );
    const r = (await ds.query(
      `SELECT id FROM dim_produit WHERE code_produit = $1 AND version_courante = true`,
      [code],
    )) as Array<{ id: string | number }>;
    ids.set(code, String(r[0]!.id));
  }
  await ins('CREDIT_GRP', 'Crédits', 'credit', 1, null);
  await ins('DEPOT_GRP', 'Dépôts', 'depot', 1, null);
  // 3 enfants sous DEPOT_GRP pour le scénario relink
  await ins('DEPOT_VUE', 'Dépôts à vue', 'depot', 2, 'DEPOT_GRP');
  await ins('DEPOT_TERME', 'Dépôts à terme', 'depot', 2, 'DEPOT_GRP');
  await ins('DEPOT_EPARGNE', 'Épargne réglementée', 'depot', 2, 'DEPOT_GRP');

  return {
    idCreditGrp: ids.get('CREDIT_GRP')!,
    idDepotGrp: ids.get('DEPOT_GRP')!,
  };
}

describe('Produit (e2e) — SCD2 hiérarchique + relink auto-référence stratégie A', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let ids: SeedIds;
  let adminToken: string;
  let lecteurToken: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'test-secret-produit-e2e-min-32-chars-yyyyyyyyyy';
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
        ProduitModule,
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
      jti: 'jti-admin-pr',
    });
    lecteurToken = await jwtService.signAsync({
      sub: ids.lecteurId,
      email: 'lecteur@miznas.local',
      jti: 'jti-lecteur-pr',
    });
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  beforeEach(async () => {
    await dataSource.query('DELETE FROM audit_log');
    await dataSource.query('UPDATE dim_produit SET fk_produit_parent = NULL');
    await dataSource.query('DELETE FROM dim_produit');
    const fresh = await seedProduits(dataSource);
    ids.idCreditGrp = fresh.idCreditGrp;
    ids.idDepotGrp = fresh.idDepotGrp;
  });

  it('GET /produits without token → 401', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/referentiels/produits')
      .expect(401);
  });

  it('GET /produits with LECTEUR → 200', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/referentiels/produits')
      .set('Authorization', `Bearer ${lecteurToken}`)
      .expect(200);
    expect(res.body.total).toBeGreaterThanOrEqual(5);
  });

  it('POST /produits with LECTEUR → 403', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/referentiels/produits')
      .set('Authorization', `Bearer ${lecteurToken}`)
      .send({
        codeProduit: 'NEW',
        libelle: 'X',
        typeProduit: 'credit',
        niveau: 2,
        codeProduitParent: 'CREDIT_GRP',
      })
      .expect(403);
  });

  it('POST valide → 201 + audit CREATE success', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/referentiels/produits')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        codeProduit: 'SERVICE_GRP',
        libelle: 'Services bancaires',
        typeProduit: 'service',
        niveau: 1,
      })
      .expect(201);
    expect(res.body.codeProduit).toBe('SERVICE_GRP');

    const audits = (await dataSource.query(
      `SELECT type_action, statut FROM audit_log WHERE entite_cible = 'dim_produit'`,
    )) as Array<{ type_action: string; statut: string }>;
    expect(
      audits.find(
        (a) => a.type_action === 'CREATE' && a.statut === 'success',
      ),
    ).toBeDefined();
  });

  it('POST avec doublon → 409', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/referentiels/produits')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        codeProduit: 'CREDIT_GRP',
        libelle: 'Dup',
        typeProduit: 'credit',
        niveau: 1,
      })
      .expect(409);
  });

  it('POST avec parent inexistant → 422', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/referentiels/produits')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        codeProduit: 'X',
        libelle: 'X',
        typeProduit: 'credit',
        niveau: 2,
        codeProduitParent: 'INEXISTANT',
      })
      .expect(422);
  });

  it('GET /produits/racines → 2 racines (CREDIT_GRP, DEPOT_GRP)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/referentiels/produits/racines')
      .set('Authorization', `Bearer ${lecteurToken}`)
      .expect(200);
    expect(res.body.map((r: { codeProduit: string }) => r.codeProduit).sort()).toEqual([
      'CREDIT_GRP',
      'DEPOT_GRP',
    ]);
  });

  it('GET /produits/par-code/DEPOT_GRP → version courante', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/referentiels/produits/par-code/DEPOT_GRP')
      .set('Authorization', `Bearer ${lecteurToken}`)
      .expect(200);
    expect(res.body.codeProduit).toBe('DEPOT_GRP');
    expect(res.body.versionCourante).toBe(true);
  });

  it('GET /produits/par-code/DEPOT_GRP/historique → 1 version', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/referentiels/produits/par-code/DEPOT_GRP/historique')
      .set('Authorization', `Bearer ${lecteurToken}`)
      .expect(200);
    expect(res.body).toHaveLength(1);
  });

  it('GET /produits/:idDepotGrp/enfants → 3 enfants', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/referentiels/produits/${ids.idDepotGrp}/enfants`)
      .set('Authorization', `Bearer ${lecteurToken}`)
      .expect(200);
    expect(res.body.length).toBe(3);
  });

  it('GET /produits/:idDepotGrp/descendants → 3 descendants', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/referentiels/produits/${ids.idDepotGrp}/descendants`)
      .set('Authorization', `Bearer ${lecteurToken}`)
      .expect(200);
    expect(res.body.length).toBe(3);
  });

  it('GET /produits?typeProduit=depot → 4 produits depot', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/referentiels/produits')
      .query({ typeProduit: 'depot' })
      .set('Authorization', `Bearer ${lecteurToken}`)
      .expect(200);
    expect(res.body.total).toBe(4); // DEPOT_GRP + 3 enfants
  });

  it('GET /produits?estPorteurInterets=true → 0 produits (aucun seed est porteur)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/referentiels/produits')
      .query({ estPorteurInterets: 'true' })
      .set('Authorization', `Bearer ${lecteurToken}`)
      .expect(200);
    expect(res.body.total).toBe(0); // aucun seed n'a estPorteurInterets=true
  });

  it('GET /produits?versionCouranteUniquement=false → inclut les versions historisées', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/referentiels/produits')
      .query({ versionCouranteUniquement: 'false' })
      .set('Authorization', `Bearer ${lecteurToken}`)
      .expect(200);
    expect(res.body.total).toBeGreaterThanOrEqual(5);
  });

  it('PATCH /par-code/DEPOT_VUE estActif=false → in-place', async () => {
    const res = await request(app.getHttpServer())
      .patch('/api/v1/referentiels/produits/par-code/DEPOT_VUE')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ estActif: false })
      .expect(200);
    expect(res.body.modeMaj).toBe('in_place_est_actif');
  });

  it('DELETE /par-code/DEPOT_VUE (feuille) → 204 + soft-close', async () => {
    await request(app.getHttpServer())
      .delete('/api/v1/referentiels/produits/par-code/DEPOT_VUE')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(204);
    const after = (await dataSource.query(
      `SELECT version_courante, est_actif FROM dim_produit WHERE code_produit = 'DEPOT_VUE'`,
    )) as Array<{ version_courante: boolean; est_actif: boolean }>;
    expect(after[0]!.version_courante).toBe(false);
    expect(after[0]!.est_actif).toBe(false);
  });

  it('DELETE /par-code/DEPOT_GRP (a 3 enfants) → 409', async () => {
    await request(app.getHttpServer())
      .delete('/api/v1/referentiels/produits/par-code/DEPOT_GRP')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(409);
  });

  // ─── SCÉNARIO CRITIQUE — relink auto-référence

  it('PATCH /par-code/DEPOT_GRP change libelle → nouvelle version SCD2 + 3 enfants relinkés', async () => {
    const ancienId = ids.idDepotGrp;

    const res = await request(app.getHttpServer())
      .patch('/api/v1/referentiels/produits/par-code/DEPOT_GRP')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ libelle: 'Dépôts (V2)' })
      .expect(200);
    expect(res.body.modeMaj).toBe('nouvelle_version');
    expect(res.body.produitsEnfantsRelinked).toBe(3);

    const versions = (await dataSource.query(
      `SELECT id, libelle, version_courante FROM dim_produit
       WHERE code_produit = 'DEPOT_GRP' ORDER BY date_debut_validite ASC`,
    )) as Array<{
      id: string | number;
      libelle: string;
      version_courante: boolean;
    }>;
    expect(versions).toHaveLength(2);
    const newId = String(versions.find((v) => v.version_courante)!.id);
    expect(newId).not.toBe(ancienId);

    // Les 3 enfants pointent vers le NOUVEL id
    const enfants = (await dataSource.query(
      `SELECT code_produit, fk_produit_parent FROM dim_produit
       WHERE code_produit IN ('DEPOT_VUE', 'DEPOT_TERME', 'DEPOT_EPARGNE') AND version_courante = true
       ORDER BY code_produit`,
    )) as Array<{
      code_produit: string;
      fk_produit_parent: string | number;
    }>;
    expect(enfants).toHaveLength(3);
    for (const e of enfants) {
      expect(String(e.fk_produit_parent)).toBe(newId);
    }

    // Pas de nouvelle version pour les enfants
    const counts = (await dataSource.query(
      `SELECT code_produit, COUNT(*)::int AS c FROM dim_produit
       WHERE code_produit IN ('DEPOT_VUE', 'DEPOT_TERME', 'DEPOT_EPARGNE') GROUP BY code_produit`,
    )) as Array<{ code_produit: string; c: number }>;
    for (const r of counts) {
      expect(r.c).toBe(1);
    }

    // audit_log : payload_apres.response.produitsEnfantsRelinked=3
    const audits = (await dataSource.query(
      `SELECT type_action, statut, payload_apres FROM audit_log
       WHERE entite_cible = 'dim_produit' AND type_action = 'UPDATE'`,
    )) as AuditRow[];
    expect(audits).toHaveLength(1);
    const payload = audits[0]!.payload_apres as {
      response?: { produitsEnfantsRelinked?: number };
    };
    expect(payload.response?.produitsEnfantsRelinked).toBe(3);
  });
});
