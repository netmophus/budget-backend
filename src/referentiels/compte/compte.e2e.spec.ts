/**
 * Tests d'intégration end-to-end /api/v1/referentiels/comptes.
 *
 * Couvre :
 *  - Permissions LECTEUR / ADMIN
 *  - CRUD avec @Auditable + sémantique 4-cas
 *  - Validations métier (cycle, niveau, classe)
 *  - **SCÉNARIO CRITIQUE — relink auto-référence stratégie A** :
 *    PATCH compte parent → nouvelle version SCD2 → comptes enfants
 *    repointés vers le nouvel id automatiquement, sans nouvelle
 *    version SCD2 des enfants. audit_log atteste
 *    `comptesEnfantsRelinked >= 1` dans `payload_apres.response`.
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
import { CompteModule } from './compte.module';

interface SeedIds {
  adminId: string;
  lecteurId: string;
  id6: string;
  id60: string;
  id61: string;
  id611: string;
  id611100: string;
  id611200: string;
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

  // Comptes : sous-arbre minimal classe 6 — 6 → 60, 61 → 611 → 611100, 611200
  // Date passée pour que les PATCH d'aujourd'hui créent une nouvelle version.
  const past = new Date(Date.now() - 30 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const ids = new Map<string, string>();
  async function ins(
    code: string,
    libelle: string,
    classe: number,
    niveau: number,
    parentCode: string | null,
    sens: string | null = null,
  ) {
    const parentId = parentCode === null ? null : ids.get(parentCode) ?? null;
    await ds.query(
      `INSERT INTO dim_compte
        ("code_compte","libelle","classe","sous_classe","fk_compte_parent",
         "niveau","sens","code_poste_budgetaire","est_compte_collectif",
         "est_porteur_interets","date_debut_validite","date_fin_validite",
         "version_courante","est_actif","utilisateur_creation")
       VALUES ($1,$2,$3,NULL,$4,$5,$6,NULL,$7,false,$8,NULL,true,true,'system')`,
      [code, libelle, classe, parentId, niveau, sens, niveau < 4, past],
    );
    const r = (await ds.query(
      `SELECT id FROM dim_compte WHERE code_compte = $1 AND version_courante = true`,
      [code],
    )) as Array<{ id: string | number }>;
    ids.set(code, String(r[0]!.id));
  }
  await ins('6', 'CHARGES', 6, 1, null, 'D');
  await ins('60', "Charges d'exploitation", 6, 2, '6', 'D');
  await ins('61', 'Charges de personnel', 6, 2, '6', 'D');
  await ins('611', 'Rémunérations', 6, 3, '61', 'D');
  await ins('611100', 'Salaires bruts', 6, 4, '611', 'D');
  await ins('611200', 'Primes et bonus', 6, 4, '611', 'D');

  return {
    adminId: userIdByEmail.get('admin@miznas.local')!,
    lecteurId: userIdByEmail.get('lecteur@miznas.local')!,
    id6: ids.get('6')!,
    id60: ids.get('60')!,
    id61: ids.get('61')!,
    id611: ids.get('611')!,
    id611100: ids.get('611100')!,
    id611200: ids.get('611200')!,
  };
}

describe('Compte (e2e) — 3ᵉ dimension SCD2 + relink auto-référence stratégie A', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let ids: SeedIds;
  let adminToken: string;
  let lecteurToken: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'test-secret-compte-e2e-min-32-chars-eeeeeeeeeeeeeeee';
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
        CompteModule,
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
    // Purge complète + reseed propre (cohérent avec cr.e2e.spec.ts).
    await dataSource.query('UPDATE dim_compte SET fk_compte_parent = NULL');
    await dataSource.query('DELETE FROM dim_compte');

    const past = new Date(Date.now() - 30 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const localIds = new Map<string, string>();
    async function ins(
      code: string,
      libelle: string,
      classe: number,
      niveau: number,
      parentCode: string | null,
      sens: string | null = null,
    ) {
      const parentId =
        parentCode === null ? null : localIds.get(parentCode) ?? null;
      await dataSource.query(
        `INSERT INTO dim_compte
          ("code_compte","libelle","classe","sous_classe","fk_compte_parent",
           "niveau","sens","code_poste_budgetaire","est_compte_collectif",
           "est_porteur_interets","date_debut_validite","date_fin_validite",
           "version_courante","est_actif","utilisateur_creation")
         VALUES ($1,$2,$3,NULL,$4,$5,$6,NULL,$7,false,$8,NULL,true,true,'system')`,
        [code, libelle, classe, parentId, niveau, sens, niveau < 4, past],
      );
      const r = (await dataSource.query(
        `SELECT id FROM dim_compte WHERE code_compte = $1 AND version_courante = true`,
        [code],
      )) as Array<{ id: string | number }>;
      localIds.set(code, String(r[0]!.id));
    }
    await ins('6', 'CHARGES', 6, 1, null, 'D');
    await ins('60', "Charges d'exploitation", 6, 2, '6', 'D');
    await ins('61', 'Charges de personnel', 6, 2, '6', 'D');
    await ins('611', 'Rémunérations', 6, 3, '61', 'D');
    await ins('611100', 'Salaires bruts', 6, 4, '611', 'D');
    await ins('611200', 'Primes et bonus', 6, 4, '611', 'D');

    ids.id6 = localIds.get('6')!;
    ids.id60 = localIds.get('60')!;
    ids.id61 = localIds.get('61')!;
    ids.id611 = localIds.get('611')!;
    ids.id611100 = localIds.get('611100')!;
    ids.id611200 = localIds.get('611200')!;
  });

  // ─── Permissions

  it('GET /comptes without token → 401', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/referentiels/comptes')
      .expect(401);
  });

  it('GET /comptes with LECTEUR → 200', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/referentiels/comptes')
      .set('Authorization', `Bearer ${lecteurToken}`)
      .expect(200);
    expect(res.body.total).toBeGreaterThanOrEqual(6);
  });

  it('POST /comptes with LECTEUR → 403', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/referentiels/comptes')
      .set('Authorization', `Bearer ${lecteurToken}`)
      .send({ codeCompte: '999', libelle: 'X', classe: '6', niveau: 2, codeCompteParent: '6' })
      .expect(403);
  });

  it('POST /comptes valide → 201 + audit CREATE success', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/referentiels/comptes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        codeCompte: '611300',
        libelle: 'Avantages en nature',
        classe: '6',
        niveau: 4,
        codeCompteParent: '611',
        sens: 'D',
        codePosteBudgetaire: 'MASSE_SALARIALE',
      })
      .expect(201);
    expect(res.body.codeCompte).toBe('611300');

    const audits = (await dataSource.query(
      `SELECT type_action, statut FROM audit_log WHERE entite_cible = 'dim_compte'`,
    )) as Array<{ type_action: string; statut: string }>;
    expect(audits.find((a) => a.type_action === 'CREATE' && a.statut === 'success')).toBeDefined();
  });

  it('POST /comptes avec codeCompte existant → 409', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/referentiels/comptes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        codeCompte: '611100',
        libelle: 'Doublon',
        classe: '6',
        niveau: 4,
        codeCompteParent: '611',
        sens: 'D',
      })
      .expect(409);
  });

  it('POST /comptes avec parent inexistant → 422', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/referentiels/comptes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        codeCompte: '999',
        libelle: 'X',
        classe: '6',
        niveau: 2,
        codeCompteParent: 'INEXISTANT',
      })
      .expect(422);
  });

  it('POST /comptes avec niveau incohérent (parent niveau 2, enfant niveau 4) → 422', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/referentiels/comptes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        codeCompte: '999',
        libelle: 'X',
        classe: '6',
        niveau: 4, // doit être 3 puisque parent (60) est niveau 2
        codeCompteParent: '60',
        sens: 'D',
      })
      .expect(422);
  });

  it('GET /comptes?classe=6 → uniquement comptes classe 6', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/referentiels/comptes')
      .query({ classe: '6' })
      .set('Authorization', `Bearer ${lecteurToken}`)
      .expect(200);
    expect(res.body.total).toBe(6);
    for (const c of res.body.items as Array<{ classe: string }>) {
      expect(c.classe).toBe('6');
    }
  });

  it('GET /:id6/descendants → toute la sous-arborescence classe 6', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/referentiels/comptes/${ids.id6}/descendants`)
      .set('Authorization', `Bearer ${lecteurToken}`)
      .expect(200);
    expect(res.body.length).toBe(5); // 60, 61, 611, 611100, 611200
  });

  it('PATCH /par-code/611100 estActif=false → in-place', async () => {
    const res = await request(app.getHttpServer())
      .patch('/api/v1/referentiels/comptes/par-code/611100')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ estActif: false })
      .expect(200);
    expect(res.body.modeMaj).toBe('in_place_est_actif');
  });

  it('DELETE /par-code/611100 (feuille) → 204 + soft-close', async () => {
    await request(app.getHttpServer())
      .delete('/api/v1/referentiels/comptes/par-code/611100')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(204);
    const after = (await dataSource.query(
      `SELECT version_courante, est_actif FROM dim_compte WHERE code_compte = '611100'`,
    )) as Array<{ version_courante: boolean; est_actif: boolean }>;
    expect(after[0]!.version_courante).toBe(false);
    expect(after[0]!.est_actif).toBe(false);
  });

  it('DELETE /par-code/611 (a des enfants) → 409', async () => {
    await request(app.getHttpServer())
      .delete('/api/v1/referentiels/comptes/par-code/611')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(409);
  });

  // ─── SCÉNARIO CRITIQUE — relink auto-référence

  it('PATCH /par-code/611 change libelle → nouvelle version SCD2 + 2 enfants relinkés (stratégie A auto-référence)', async () => {
    const ancienId = ids.id611;

    const res = await request(app.getHttpServer())
      .patch('/api/v1/referentiels/comptes/par-code/611')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ libelle: 'Rémunérations (V2)' })
      .expect(200);
    expect(res.body.modeMaj).toBe('nouvelle_version');
    expect(res.body.comptesEnfantsRelinked).toBe(2); // 611100 + 611200

    // dim_compte : 2 lignes pour 611 (V1 fermée, V2 courante)
    const versions611 = (await dataSource.query(
      `SELECT id, libelle, version_courante FROM dim_compte
       WHERE code_compte = '611' ORDER BY date_debut_validite ASC`,
    )) as Array<{ id: string | number; libelle: string; version_courante: boolean }>;
    expect(versions611).toHaveLength(2);
    const newId = String(versions611.find((v) => v.version_courante)!.id);
    expect(newId).not.toBe(ancienId);

    // Les 2 enfants pointent maintenant vers le NOUVEL id de 611
    const enfants = (await dataSource.query(
      `SELECT code_compte, fk_compte_parent FROM dim_compte
       WHERE code_compte IN ('611100', '611200') AND version_courante = true
       ORDER BY code_compte`,
    )) as Array<{ code_compte: string; fk_compte_parent: string | number }>;
    expect(enfants).toHaveLength(2);
    for (const e of enfants) {
      expect(String(e.fk_compte_parent)).toBe(newId);
    }

    // Les enfants n'ont PAS créé de nouvelle version (1 ligne par code)
    const counts = (await dataSource.query(
      `SELECT code_compte, COUNT(*)::int AS c FROM dim_compte
       WHERE code_compte IN ('611100', '611200') GROUP BY code_compte`,
    )) as Array<{ code_compte: string; c: number }>;
    for (const r of counts) {
      expect(r.c).toBe(1);
    }

    // audit_log : UPDATE success avec comptesEnfantsRelinked=2
    const audits = (await dataSource.query(
      `SELECT type_action, statut, payload_apres FROM audit_log
       WHERE entite_cible = 'dim_compte' AND type_action = 'UPDATE'`,
    )) as AuditRow[];
    expect(audits).toHaveLength(1);
    const payload = audits[0]!.payload_apres as {
      response?: { comptesEnfantsRelinked?: number };
    };
    expect(payload.response?.comptesEnfantsRelinked).toBe(2);
  });
});
