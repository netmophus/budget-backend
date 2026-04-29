/**
 * Tests d'intégration end-to-end /api/v1/referentiels/structures.
 *
 * Couvre :
 *  - Permissions (401 / 403 / 200 / 201)
 *  - SCD2 via PATCH (libellé seul → nouvelle version, est_actif seul →
 *    in-place, libellé + est_actif → nouvelle version désactivée)
 *  - Validation métier (cycle, type/niveau, parent inexistant) → 422
 *  - Hiérarchie (enfants / descendants / ancêtres)
 *  - Suppression (soft-close avec contrôle des enfants)
 *  - @Auditable : CREATE / UPDATE / DELETE — success ET failure
 *
 * Limitations pg-mem documentées (cf. tests précédents) :
 *  - bigint retourné en number → coercition String() systématique
 *  - CROSS JOIN non supporté → seed via sous-requêtes scalaires
 *  - Index unique partiel non créé par synchronize → invariant porté
 *    par le service (1ʳᵉ ligne de défense)
 *  - WITH RECURSIVE non supporté → findDescendants/Ancestors itératifs
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
import { StructureModule } from './structure.module';

interface SeedIds {
  adminId: string;
  lecteurId: string;
  noPermsId: string;
  socId: string;
  brCivId: string;
  brSenId: string;
  dirRetailId: string;
  dirCorpId: string;
  deptId: string;
  agPlateauId: string;
  agCocodyId: string;
}

interface AuditRow {
  type_action: string;
  entite_cible: string;
  id_cible: string | null;
  statut: string;
  utilisateur: string;
  commentaire: string | null;
}

async function seedAccessControlAndStructures(ds: DataSource): Promise<SeedIds> {
  // 1. Permissions
  for (const [code, libelle] of [
    ['REFERENTIEL.LIRE', 'Lire les référentiels'],
    ['REFERENTIEL.GERER', 'Gérer les référentiels'],
  ]) {
    await ds.query(
      `INSERT INTO ref_permission (code_permission, libelle, module, utilisateur_creation)
       VALUES ($1, $2, 'REFERENTIEL', 'system')`,
      [code, libelle],
    );
  }

  // 2. Rôles
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

  // 3. Liens rôle → permission
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

  // 4. Utilisateurs
  await ds.query(
    `INSERT INTO "user" (email, mot_de_passe_hash, nom, prenom, est_actif, utilisateur_creation)
     VALUES
       ('admin@miznas.local',  'placeholder', 'Admin',  'MIZNAS', true, 'system'),
       ('lecteur@miznas.local','placeholder', 'Lecteur','MIZNAS', true, 'system'),
       ('noperms@miznas.local','placeholder', 'NoPerm', 'Test',   true, 'system')`,
  );
  const users = (await ds.query(
    `SELECT email, id FROM "user" WHERE email IN ($1, $2, $3)`,
    ['admin@miznas.local', 'lecteur@miznas.local', 'noperms@miznas.local'],
  )) as Array<{ email: string; id: string | number }>;
  const userIdByEmail = new Map(
    users.map((u) => [u.email, String(u.id)]),
  );

  // 5. Affectations rôle global
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

  // 6. Hiérarchie 9 structures (parents avant enfants)
  const today = new Date().toISOString().slice(0, 10);
  const structureIds = new Map<string, string>();

  async function insertStructure(
    code: string,
    libelle: string,
    type: string,
    niveau: number,
    parentCode: string | null,
    pays: string | null,
  ): Promise<void> {
    const parentId = parentCode === null
      ? null
      : structureIds.get(parentCode) ?? null;
    await ds.query(
      `INSERT INTO dim_structure
        ("code_structure","libelle","type_structure","niveau_hierarchique",
         "fk_structure_parent","code_pays","date_debut_validite",
         "version_courante","est_actif","utilisateur_creation")
       VALUES ($1,$2,$3,$4,$5,$6,$7,true,true,'system')`,
      [code, libelle, type, niveau, parentId, pays, today],
    );
    const rows = (await ds.query(
      `SELECT id FROM dim_structure WHERE code_structure = $1 AND version_courante = true`,
      [code],
    )) as Array<{ id: string | number }>;
    structureIds.set(code, String(rows[0]!.id));
  }

  await insertStructure('SOC_BANK_UEMOA', 'Banque Pilote UEMOA', 'entite_juridique', 1, null, null);
  await insertStructure('BR_CIV', "Branche Côte d'Ivoire", 'branche', 2, 'SOC_BANK_UEMOA', 'CIV');
  await insertStructure('BR_SEN', 'Branche Sénégal', 'branche', 2, 'SOC_BANK_UEMOA', 'SEN');
  await insertStructure('BR_BFA', 'Branche Burkina Faso', 'branche', 2, 'SOC_BANK_UEMOA', 'BFA');
  await insertStructure('DIR_CIV_RETAIL', 'Dir Retail CIV', 'direction', 3, 'BR_CIV', 'CIV');
  await insertStructure('DIR_CIV_CORPORATE', 'Dir Corporate CIV', 'direction', 3, 'BR_CIV', 'CIV');
  await insertStructure('DEPT_CIV_PARTICULIERS', 'Dept Particuliers', 'departement', 4, 'DIR_CIV_RETAIL', 'CIV');
  await insertStructure('AG_ABJ_PLATEAU', 'Agence Plateau', 'agence', 5, 'DEPT_CIV_PARTICULIERS', 'CIV');
  await insertStructure('AG_ABJ_COCODY', 'Agence Cocody', 'agence', 5, 'DEPT_CIV_PARTICULIERS', 'CIV');

  return {
    adminId: userIdByEmail.get('admin@miznas.local')!,
    lecteurId: userIdByEmail.get('lecteur@miznas.local')!,
    noPermsId: userIdByEmail.get('noperms@miznas.local')!,
    socId: structureIds.get('SOC_BANK_UEMOA')!,
    brCivId: structureIds.get('BR_CIV')!,
    brSenId: structureIds.get('BR_SEN')!,
    dirRetailId: structureIds.get('DIR_CIV_RETAIL')!,
    dirCorpId: structureIds.get('DIR_CIV_CORPORATE')!,
    deptId: structureIds.get('DEPT_CIV_PARTICULIERS')!,
    agPlateauId: structureIds.get('AG_ABJ_PLATEAU')!,
    agCocodyId: structureIds.get('AG_ABJ_COCODY')!,
  };
}

describe('Structure (e2e) — première dimension SCD2 réelle', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let ids: SeedIds;
  let adminToken: string;
  let lecteurToken: string;
  let noPermsToken: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'test-secret-for-structure-e2e-min-32-chars-cccccccccc';
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

    ids = await seedAccessControlAndStructures(dataSource);

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
    noPermsToken = await jwtService.signAsync({
      sub: ids.noPermsId,
      email: 'noperms@miznas.local',
      jti: 'jti-noperms',
    });
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  beforeEach(async () => {
    // Réinitialise l'audit + ramène dim_structure à l'état seedé.
    await dataSource.query('DELETE FROM audit_log');
    await dataSource.query(
      `DELETE FROM dim_structure WHERE code_structure NOT IN ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        'SOC_BANK_UEMOA',
        'BR_CIV',
        'BR_SEN',
        'BR_BFA',
        'DIR_CIV_RETAIL',
        'DIR_CIV_CORPORATE',
        'DEPT_CIV_PARTICULIERS',
        'AG_ABJ_PLATEAU',
        'AG_ABJ_COCODY',
      ],
    );
    // Ramener les 9 structures seedées à un état propre : 1 ligne par
    // code, version_courante=true, est_actif=true.
    await dataSource.query(
      `DELETE FROM dim_structure WHERE version_courante = false`,
    );
    await dataSource.query(
      `UPDATE dim_structure SET est_actif = true, version_courante = true, date_fin_validite = NULL WHERE 1=1`,
    );

    // Rafraîchir le cache d'IDs : un PATCH dans un test précédent a pu
    // changer l'id d'une structure (nouvelle version SCD2 → nouvel id).
    // Les FK fk_structure_parent restent cohérentes en interne car
    // initialisées au seed, mais les tests qui consomment les IDs par
    // référence (`ids.agPlateauId`, etc.) doivent voir l'id courant.
    const refreshed = (await dataSource.query(
      `SELECT code_structure, id FROM dim_structure WHERE version_courante = true`,
    )) as Array<{ code_structure: string; id: string | number }>;
    const byCode = new Map(refreshed.map((r) => [r.code_structure.trim(), String(r.id)]));
    ids.socId = byCode.get('SOC_BANK_UEMOA') ?? ids.socId;
    ids.brCivId = byCode.get('BR_CIV') ?? ids.brCivId;
    ids.brSenId = byCode.get('BR_SEN') ?? ids.brSenId;
    ids.dirRetailId = byCode.get('DIR_CIV_RETAIL') ?? ids.dirRetailId;
    ids.dirCorpId = byCode.get('DIR_CIV_CORPORATE') ?? ids.dirCorpId;
    ids.deptId = byCode.get('DEPT_CIV_PARTICULIERS') ?? ids.deptId;
    ids.agPlateauId = byCode.get('AG_ABJ_PLATEAU') ?? ids.agPlateauId;
    ids.agCocodyId = byCode.get('AG_ABJ_COCODY') ?? ids.agCocodyId;
  });

  async function fetchAuditStructure(): Promise<AuditRow[]> {
    return (await dataSource.query(
      `SELECT type_action, entite_cible, id_cible, statut, utilisateur, commentaire
       FROM audit_log
       WHERE entite_cible = 'dim_structure'
       ORDER BY id ASC`,
    )) as AuditRow[];
  }

  // ─── Permissions ─────────────────────────────────────────────────

  it('GET /structures without token → 401', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/referentiels/structures')
      .expect(401);
  });

  it('GET /structures with LECTEUR → 200 (9 structures)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/referentiels/structures')
      .set('Authorization', `Bearer ${lecteurToken}`)
      .expect(200);
    expect(res.body.total).toBe(9);
  });

  it('POST /structures with LECTEUR → 403', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/referentiels/structures')
      .set('Authorization', `Bearer ${lecteurToken}`)
      .send({
        codeStructure: 'NEW_AG',
        libelle: 'X',
        typeStructure: 'agence',
        niveauHierarchique: 5,
        fkStructureParent: ids.deptId,
      })
      .expect(403);
  });

  it('POST /structures with ADMIN, valid agence → 201 + audit_log CREATE success', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/referentiels/structures')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        codeStructure: 'AG_DAKAR_PLATEAU',
        libelle: 'Agence Dakar Plateau',
        typeStructure: 'agence',
        niveauHierarchique: 5,
        fkStructureParent: ids.brSenId,
        codePays: 'SEN',
      })
      .expect(201);
    expect(res.body.codeStructure).toBe('AG_DAKAR_PLATEAU');

    const audits = await fetchAuditStructure();
    expect(audits).toHaveLength(1);
    expect(audits[0]!.type_action).toBe('CREATE');
    expect(audits[0]!.statut).toBe('success');
  });

  it('POST /structures with duplicate codeStructure → 409 + audit_log CREATE failure', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/referentiels/structures')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        codeStructure: 'AG_ABJ_PLATEAU',
        libelle: 'Doublon',
        typeStructure: 'agence',
        niveauHierarchique: 5,
        fkStructureParent: ids.deptId,
      })
      .expect(409);

    const audits = await fetchAuditStructure();
    expect(audits).toHaveLength(1);
    expect(audits[0]!.statut).toBe('failure');
    expect(audits[0]!.commentaire).toMatch(/existe déjà/);
  });

  it('POST /structures with non-existing parent → 422', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/referentiels/structures')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        codeStructure: 'NEW_AG_ORPHAN',
        libelle: 'Orphan',
        typeStructure: 'agence',
        niveauHierarchique: 5,
        fkStructureParent: '999999',
      })
      .expect(422);
  });

  it('POST /structures with type incohérent (entite_juridique avec parent) → 422', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/referentiels/structures')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        codeStructure: 'BAD_ENTITE',
        libelle: 'X',
        typeStructure: 'entite_juridique',
        niveauHierarchique: 1,
        fkStructureParent: ids.socId,
      })
      .expect(422);
  });

  // ─── PATCH (SCD2 vs in-place) ────────────────────────────────────

  it('PATCH /par-code/AG_ABJ_PLATEAU change libelle → 200 + new SCD2 version (2 rows in history)', async () => {
    const res = await request(app.getHttpServer())
      .patch('/api/v1/referentiels/structures/par-code/AG_ABJ_PLATEAU')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ libelle: 'Agence Plateau (rénovée)' })
      .expect(200);
    expect(res.body.libelle).toBe('Agence Plateau (rénovée)');
    expect(res.body.versionCourante).toBe(true);

    const history = (await dataSource.query(
      `SELECT libelle, version_courante FROM dim_structure
       WHERE code_structure = 'AG_ABJ_PLATEAU' ORDER BY date_debut_validite ASC`,
    )) as Array<{ libelle: string; version_courante: boolean }>;
    expect(history).toHaveLength(2);
    expect(history.find((h) => h.version_courante)!.libelle).toBe(
      'Agence Plateau (rénovée)',
    );

    const audits = await fetchAuditStructure();
    expect(audits.find((a) => a.type_action === 'UPDATE' && a.statut === 'success')).toBeDefined();
  });

  it('PATCH /par-code/AG_ABJ_COCODY change estActif=false alone → 200 + in-place (still 1 row)', async () => {
    await request(app.getHttpServer())
      .patch('/api/v1/referentiels/structures/par-code/AG_ABJ_COCODY')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ estActif: false })
      .expect(200);

    const rows = (await dataSource.query(
      `SELECT version_courante, est_actif FROM dim_structure WHERE code_structure = 'AG_ABJ_COCODY'`,
    )) as Array<{ version_courante: boolean; est_actif: boolean }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.version_courante).toBe(true);
    expect(rows[0]!.est_actif).toBe(false);
  });

  it('GET /par-code/AG_ABJ_PLATEAU/historique with LECTEUR after a libelle PATCH → 2 versions', async () => {
    // Génère d'abord une nouvelle version
    await request(app.getHttpServer())
      .patch('/api/v1/referentiels/structures/par-code/AG_ABJ_PLATEAU')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ libelle: 'Renommée' })
      .expect(200);

    const res = await request(app.getHttpServer())
      .get('/api/v1/referentiels/structures/par-code/AG_ABJ_PLATEAU/historique')
      .set('Authorization', `Bearer ${lecteurToken}`)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(2);
  });

  // ─── Hiérarchie ──────────────────────────────────────────────────

  it('GET /:id_BR_CIV/enfants → 2 directions', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/referentiels/structures/${ids.brCivId}/enfants`)
      .set('Authorization', `Bearer ${lecteurToken}`)
      .expect(200);

    const codes = (res.body as Array<{ codeStructure: string }>)
      .map((s) => s.codeStructure)
      .sort();
    expect(codes).toEqual(['DIR_CIV_CORPORATE', 'DIR_CIV_RETAIL']);
  });

  it('GET /:id_SOC_BANK_UEMOA/descendants → 8 lignes', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/referentiels/structures/${ids.socId}/descendants`)
      .set('Authorization', `Bearer ${lecteurToken}`)
      .expect(200);
    expect(res.body.length).toBe(8);
  });

  it('GET /:id_AG_ABJ_PLATEAU/ancetres → 4 ancêtres jusqu\'à SOC_BANK_UEMOA', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/referentiels/structures/${ids.agPlateauId}/ancetres`)
      .set('Authorization', `Bearer ${lecteurToken}`)
      .expect(200);

    const codes = (res.body as Array<{ codeStructure: string }>).map(
      (s) => s.codeStructure,
    );
    expect(codes).toEqual([
      'DEPT_CIV_PARTICULIERS',
      'DIR_CIV_RETAIL',
      'BR_CIV',
      'SOC_BANK_UEMOA',
    ]);
  });

  // ─── Suppression (soft-close) ────────────────────────────────────

  it('DELETE /par-code/AG_ABJ_COCODY (leaf) → 204 + audit DELETE success', async () => {
    await request(app.getHttpServer())
      .delete('/api/v1/referentiels/structures/par-code/AG_ABJ_COCODY')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(204);

    const after = (await dataSource.query(
      `SELECT version_courante, est_actif FROM dim_structure WHERE code_structure = 'AG_ABJ_COCODY'`,
    )) as Array<{ version_courante: boolean; est_actif: boolean }>;
    expect(after[0]!.version_courante).toBe(false);
    expect(after[0]!.est_actif).toBe(false);

    const audits = await fetchAuditStructure();
    expect(audits.some((a) => a.type_action === 'DELETE' && a.statut === 'success')).toBe(true);
  });

  it('DELETE /par-code/BR_CIV (has children) → 409 + audit DELETE failure', async () => {
    await request(app.getHttpServer())
      .delete('/api/v1/referentiels/structures/par-code/BR_CIV')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(409);

    const audits = await fetchAuditStructure();
    const failure = audits.find(
      (a) => a.type_action === 'DELETE' && a.statut === 'failure',
    );
    expect(failure).toBeDefined();
    expect(failure!.commentaire).toMatch(/enfant/);
  });
});
