/**
 * Tests e2e POST /api/v1/referentiels/comptes/import.
 *
 * Couvre :
 *  - Permissions (401 sans token, 403 lecteur, 200 admin).
 *  - Garde-fous d'upload (400 sans fichier, 400 mimetype non-CSV).
 *  - Mode insert-only nominal sur petit batch.
 *  - **SCÉNARIO CRITIQUE — UPSERT SCD2** : 1 nouveau compte +
 *    1 modification de compte existant → imported=1, updated=1,
 *    audit_log contient UNE entrée IMPORT avec le rapport complet.
 *
 * Le seed est volontairement minimal (6 comptes au lieu des 94 du
 * seed prod) pour garder le test rapide. La logique SCD2 testée est
 * identique.
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
}

interface AuditRow {
  type_action: string;
  entite_cible: string;
  statut: string;
  utilisateur: string;
  payload_apres: unknown;
  commentaire: string | null;
}

const HEADER =
  'code_compte,libelle,classe,sous_classe,code_compte_parent,niveau,sens,code_poste_budgetaire,est_compte_collectif,est_porteur_interets';

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

async function seedComptes(ds: DataSource): Promise<void> {
  // Date passée pour que l'UPSERT crée une nouvelle version SCD2
  // (pas un écrasement intra-jour).
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
    const parentId = parentCode === null ? null : (ids.get(parentCode) ?? null);
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
}

describe('Compte import (e2e) — POST /api/v1/referentiels/comptes/import', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let ids: SeedIds;
  let adminToken: string;
  let lecteurToken: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET =
      'test-secret-compte-import-e2e-min-32-chars-aaaaaa';
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

    ids = await seedRolesUsers(dataSource);

    adminToken = await jwtService.signAsync({
      sub: ids.adminId,
      email: 'admin@miznas.local',
      jti: 'jti-admin-import',
    });
    lecteurToken = await jwtService.signAsync({
      sub: ids.lecteurId,
      email: 'lecteur@miznas.local',
      jti: 'jti-lecteur-import',
    });
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  beforeEach(async () => {
    await dataSource.query('DELETE FROM audit_log');
    await dataSource.query('UPDATE dim_compte SET fk_compte_parent = NULL');
    await dataSource.query('DELETE FROM dim_compte');
    await seedComptes(dataSource);
  });

  // ─── Permissions

  it('POST /import sans token → 401', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/referentiels/comptes/import')
      .attach(
        'file',
        Buffer.from(`${HEADER}\n6,X,6,,,1,D,,false,false`),
        'x.csv',
      )
      .expect(401);
  });

  it('POST /import avec LECTEUR → 403', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/referentiels/comptes/import')
      .set('Authorization', `Bearer ${lecteurToken}`)
      .attach(
        'file',
        Buffer.from(`${HEADER}\n6,X,6,,,1,D,,false,false`),
        'x.csv',
      )
      .expect(403);
  });

  // ─── Validation upload

  it('POST /import sans fichier → 400', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/referentiels/comptes/import')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400);
  });

  it('POST /import avec fichier non-CSV → 400', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/referentiels/comptes/import')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', Buffer.from('not a csv'), {
        filename: 'data.pdf',
        contentType: 'application/pdf',
      })
      .expect(400);
  });

  // ─── Nominal insert-only

  it('POST /import mode=insert-only nominal → 200 + 1 nouveau compte', async () => {
    const csv = [
      HEADER,
      '611300,Avantages en nature,6,,611,4,D,MASSE_SALARIALE,false,false',
    ].join('\n');

    const res = await request(app.getHttpServer())
      .post('/api/v1/referentiels/comptes/import')
      .query({ mode: 'insert-only' })
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', Buffer.from(csv), 'pcb.csv')
      .expect(200);

    expect(res.body).toMatchObject({
      totalLines: 1,
      imported: 1,
      updated: 0,
      skipped: 0,
      errors: [],
    });

    const inDb = (await dataSource.query(
      `SELECT COUNT(*)::int AS c FROM dim_compte WHERE version_courante = true`,
    )) as Array<{ c: number }>;
    expect(inDb[0]!.c).toBe(7); // 6 du seed + 1 nouveau
  });

  // ─── SCÉNARIO CRITIQUE — UPSERT SCD2

  it('SCÉNARIO CRITIQUE : POST /import mode=upsert avec 1 nouveau + 1 modifié → imported=1, updated=1, audit IMPORT', async () => {
    // 1 nouveau compte (611400) + 1 compte existant avec libellé modifié (611100).
    const csv = [
      HEADER,
      '611100,Salaires bruts (V2 — révisé 2026),6,,611,4,D,,false,false',
      '611400,Indemnités de transport,6,,611,4,D,MASSE_SALARIALE,false,false',
    ].join('\n');

    const res = await request(app.getHttpServer())
      .post('/api/v1/referentiels/comptes/import')
      .query({ mode: 'upsert' })
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', Buffer.from(csv), 'pcb-upsert.csv')
      .expect(200);

    // (a) Réponse rapport
    expect(res.body).toMatchObject({
      totalLines: 2,
      imported: 1,
      updated: 1,
      skipped: 0,
      errors: [],
    });

    // (b) En base : 7 comptes courants (6 du seed + 1 nouveau).
    //     Le 611100 garde 1 seule version courante (la nouvelle), l'ancienne est fermée.
    const courants = (await dataSource.query(
      `SELECT COUNT(*)::int AS c FROM dim_compte WHERE version_courante = true`,
    )) as Array<{ c: number }>;
    expect(courants[0]!.c).toBe(7);

    // (c) 611400 nouvellement créé en base
    const nouveau611400 = (await dataSource.query(
      `SELECT code_compte, libelle FROM dim_compte WHERE code_compte = '611400' AND version_courante = true`,
    )) as Array<{ code_compte: string; libelle: string }>;
    expect(nouveau611400).toHaveLength(1);
    expect(nouveau611400[0]!.libelle).toBe('Indemnités de transport');

    // (d) 611100 a 2 versions : V1 fermée + V2 courante avec nouveau libellé
    const versions611100 = (await dataSource.query(
      `SELECT libelle, version_courante FROM dim_compte
       WHERE code_compte = '611100' ORDER BY date_debut_validite ASC`,
    )) as Array<{ libelle: string; version_courante: boolean }>;
    expect(versions611100).toHaveLength(2);
    expect(versions611100[0]!.version_courante).toBe(false);
    expect(versions611100[0]!.libelle).toBe('Salaires bruts');
    expect(versions611100[1]!.version_courante).toBe(true);
    expect(versions611100[1]!.libelle).toBe(
      'Salaires bruts (V2 — révisé 2026)',
    );

    // (e) audit_log : UNE entrée IMPORT avec le rapport complet en payload_apres.
    //     Note : l'UPDATE 611100 passe par CompteService.update qui n'est PAS
    //     décoré @Auditable (l'audit appartient à la route). On attend donc
    //     uniquement l'entrée IMPORT racine.
    const audits = (await dataSource.query(
      `SELECT type_action, statut, payload_apres, utilisateur
       FROM audit_log WHERE type_action = 'IMPORT'`,
    )) as AuditRow[];
    expect(audits).toHaveLength(1);
    expect(audits[0]!.statut).toBe('success');
    expect(audits[0]!.utilisateur).toBe('admin@miznas.local');
    const payload = audits[0]!.payload_apres as {
      response?: {
        totalLines: number;
        imported: number;
        updated: number;
        skipped: number;
        errors: unknown[];
      };
    };
    expect(payload.response).toMatchObject({
      totalLines: 2,
      imported: 1,
      updated: 1,
      skipped: 0,
      errors: [],
    });
  });
});
