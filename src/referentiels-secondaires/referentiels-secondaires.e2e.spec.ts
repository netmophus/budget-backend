/**
 * Tests e2e échantillons sur 3 référentiels secondaires :
 *  - ref_type_structure (5 valeurs, est_systeme mixte, référencé par
 *    dim_structure.type_structure)
 *  - ref_categorie_segment (6 valeurs, simple)
 *  - ref_type_action_audit (14 valeurs, toutes est_systeme=true)
 *
 * Le pattern de toutes les routes est identique (même factory de
 * controller), donc ces 3 échantillons couvrent la chaîne en e2e ; les
 * 10 autres référentiels sont testés indirectement via les unit tests
 * du socle BaseRefSecondaireService + l'enregistrement Nest dans
 * AppModule (compilable).
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

import { AuditModule } from '../audit/audit.module';
import { AuditInterceptor } from '../audit/interceptors/audit.interceptor';
import { AuthModule } from '../auth/auth.module';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { AllExceptionsFilter } from '../common/filters/all-exceptions.filter';
import { CentreResponsabiliteModule } from '../referentiels/centre-responsabilite/centre-responsabilite.module';
import { CompteModule } from '../referentiels/compte/compte.module';
import { DeviseModule } from '../referentiels/devise/devise.module';
import { LigneMetierModule } from '../referentiels/ligne-metier/ligne-metier.module';
import { ProduitModule } from '../referentiels/produit/produit.module';
import { ScenarioModule } from '../referentiels/scenario/scenario.module';
import { SegmentModule } from '../referentiels/segment/segment.module';
import { StructureModule } from '../referentiels/structure/structure.module';
import { TempsModule } from '../referentiels/temps/temps.module';
import { VersionModule } from '../referentiels/version/version.module';
import { RolesModule } from '../roles/roles.module';
import { UsersModule } from '../users/users.module';
import { RefCategorieSegmentModule } from './categorie-segment/ref-categorie-segment.module';
import { RefClasseCompteModule } from './classe-compte/ref-classe-compte.module';
import { RefPaysModule } from './pays/ref-pays.module';
import { RefSensCompteModule } from './sens-compte/ref-sens-compte.module';
import { RefStatutScenarioModule } from './statut-scenario/ref-statut-scenario.module';
import { RefStatutVersionModule } from './statut-version/ref-statut-version.module';
import { RefTypeActionAuditModule } from './type-action-audit/ref-type-action-audit.module';
import { RefTypeCrModule } from './type-cr/ref-type-cr.module';
import { RefTypeProduitModule } from './type-produit/ref-type-produit.module';
import { RefTypeScenarioModule } from './type-scenario/ref-type-scenario.module';
import { RefTypeStructureModule } from './type-structure/ref-type-structure.module';
import { RefTypeTauxModule } from './type-taux/ref-type-taux.module';
import { RefTypeVersionModule } from './type-version/ref-type-version.module';

interface SeedIds {
  adminId: string;
  lecteurId: string;
}

async function seedRolesUsers(ds: DataSource): Promise<SeedIds> {
  for (const [code, libelle, mod] of [
    ['CONFIGURATION.LIRE', 'Lire config', 'CONFIGURATION'],
    ['CONFIGURATION.GERER', 'Gérer config', 'CONFIGURATION'],
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
  ]) {
    await ds.query(
      `INSERT INTO ref_role (code_role, libelle, est_actif, utilisateur_creation)
       VALUES ($1, $2, true, 'system')`,
      [code, libelle],
    );
  }
  for (const [r, p] of [
    ['ADMIN', 'CONFIGURATION.LIRE'],
    ['ADMIN', 'CONFIGURATION.GERER'],
    ['LECTEUR', 'CONFIGURATION.LIRE'],
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

/**
 * Hydratation des seeds "tels qu'ils seraient après les 13 migrations".
 * Pg-mem ne joue pas les migrations TypeORM (synchronize crée les
 * tables depuis les entités, pas depuis les fichiers de migration),
 * donc on insère manuellement les valeurs initiales pour les 3
 * référentiels échantillons.
 */
async function seedRefValuesInitiales(ds: DataSource): Promise<void> {
  // ref_type_structure (5 valeurs)
  for (const [code, libelle, ordre, estSysteme] of [
    ['entite_juridique', 'Entité juridique', 10, true],
    ['branche', 'Branche', 20, true],
    ['direction', 'Direction', 30, true],
    ['departement', 'Département', 40, true],
    ['agence', 'Agence', 50, false],
  ] as const) {
    await ds.query(
      `INSERT INTO ref_type_structure (code, libelle, ordre, est_systeme, utilisateur_creation)
       VALUES ($1, $2, $3, $4, 'system')`,
      [code, libelle, ordre, estSysteme],
    );
  }
  // ref_categorie_segment (6 valeurs)
  for (const [code, libelle, ordre, estSysteme] of [
    ['particulier', 'Particulier', 10, false],
    ['professionnel', 'Professionnel', 20, false],
    ['pme', 'PME', 30, false],
    ['grande_entreprise', 'Grande entreprise', 40, false],
    ['institutionnel', 'Institutionnel', 50, true],
    ['secteur_public', 'Secteur public', 60, true],
  ] as const) {
    await ds.query(
      `INSERT INTO ref_categorie_segment (code, libelle, ordre, est_systeme, utilisateur_creation)
       VALUES ($1, $2, $3, $4, 'system')`,
      [code, libelle, ordre, estSysteme],
    );
  }
  // ref_type_action_audit (14 valeurs, toutes est_systeme)
  const audits: ReadonlyArray<readonly [string, string, number]> = [
    ['CREATE', 'Création', 10],
    ['UPDATE', 'Modification', 20],
    ['DELETE', 'Suppression', 30],
    ['IMPORT', 'Import', 40],
    ['EXPORT', 'Export', 45],
    ['LOGIN', 'Connexion', 50],
    ['LOGIN_FAILED', 'Échec de connexion', 55],
    ['LOGOUT', 'Déconnexion', 60],
    ['REFRESH', 'Rafraîchissement de jeton', 65],
    ['REFRESH_FORCED_REVOCATION', 'Révocation forcée de jeton', 67],
    ['VALIDATE', 'Validation', 70],
    ['FREEZE', 'Gel', 80],
    ['PERMISSION_DENIED', 'Permission refusée', 90],
    ['LIRE_AUDIT', "Consultation du journal d'audit", 95],
  ];
  for (const [code, libelle, ordre] of audits) {
    await ds.query(
      `INSERT INTO ref_type_action_audit (code, libelle, ordre, est_systeme, utilisateur_creation)
       VALUES ($1, $2, $3, true, 'system')`,
      [code, libelle, ordre],
    );
  }
}

/**
 * Crée une dim_structure de test qui RÉFÉRENCE 'agence' — pour valider
 * le refus de DELETE sur valeur référencée.
 */
async function seedDimStructureAgence(ds: DataSource): Promise<void> {
  await ds.query(
    `INSERT INTO dim_structure
      ("code_structure","libelle","libelle_court","type_structure","niveau_hierarchique",
       "fk_structure_parent","code_pays","date_debut_validite","date_fin_validite",
       "version_courante","est_actif","utilisateur_creation")
     VALUES ('AG_TEST','Agence Test',NULL,'agence',5,NULL,'CIV','2026-01-01',NULL,true,true,'system')`,
  );
}

describe('Référentiels secondaires (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let ids: SeedIds;
  let adminToken: string;
  let lecteurToken: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'test-secret-ref-secondaires-e2e-min-32-chars-aaa';
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
        TempsModule,
        DeviseModule,
        StructureModule,
        CentreResponsabiliteModule,
        CompteModule,
        LigneMetierModule,
        ProduitModule,
        SegmentModule,
        VersionModule,
        ScenarioModule,
        // Les 3 modules échantillons exercés en profondeur ↓
        RefTypeStructureModule,
        RefCategorieSegmentModule,
        RefTypeActionAuditModule,
        // Les 10 autres modules : importés pour couvrir leur
        // enregistrement Nest + exercer leur GET smoke ↓
        RefPaysModule,
        RefTypeCrModule,
        RefSensCompteModule,
        RefClasseCompteModule,
        RefTypeProduitModule,
        RefTypeVersionModule,
        RefStatutVersionModule,
        RefTypeScenarioModule,
        RefStatutScenarioModule,
        RefTypeTauxModule,
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
      jti: 'jti-admin-ref-sec',
    });
    lecteurToken = await jwtService.signAsync({
      sub: ids.lecteurId,
      email: 'lecteur@miznas.local',
      jti: 'jti-lecteur-ref-sec',
    });
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  beforeEach(async () => {
    await dataSource.query('DELETE FROM audit_log');
    await dataSource.query('UPDATE dim_structure SET fk_structure_parent = NULL');
    await dataSource.query('DELETE FROM dim_structure');
    await dataSource.query('DELETE FROM ref_type_structure');
    await dataSource.query('DELETE FROM ref_categorie_segment');
    await dataSource.query('DELETE FROM ref_type_action_audit');
    await seedRefValuesInitiales(dataSource);
  });

  // ─── Permissions

  it('GET /api/v1/configuration/type-structure sans token → 401', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/configuration/type-structure')
      .expect(401);
  });

  it('LECTEUR : GET → 200', async () => {
    const r = await request(app.getHttpServer())
      .get('/api/v1/configuration/type-structure')
      .set('Authorization', `Bearer ${lecteurToken}`)
      .expect(200);
    expect(r.body.total).toBe(5);
    expect(r.body.items.map((i: { code: string }) => i.code)).toEqual([
      'entite_juridique',
      'branche',
      'direction',
      'departement',
      'agence',
    ]);
  });

  it('LECTEUR : POST → 403', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/configuration/type-structure')
      .set('Authorization', `Bearer ${lecteurToken}`)
      .send({ code: 'succursale', libelle: 'Succursale' })
      .expect(403);
  });

  // ─── ref_type_structure (référencé par dim_structure)

  describe('ref_type_structure', () => {
    it('ADMIN : POST nouvelle valeur "succursale" → 201 + audit CREATE', async () => {
      const r = await request(app.getHttpServer())
        .post('/api/v1/configuration/type-structure')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          code: 'succursale',
          libelle: 'Succursale',
          description: 'Sans personnel permanent.',
          ordre: 60,
        })
        .expect(201);
      expect(r.body.code).toBe('succursale');
      expect(r.body.estSysteme).toBe(false);
      expect(r.body.estActif).toBe(true);

      const audits = (await dataSource.query(
        `SELECT type_action, statut FROM audit_log WHERE entite_cible='ref_type_structure'`,
      )) as Array<{ type_action: string; statut: string }>;
      expect(
        audits.find(
          (a) => a.type_action === 'CREATE' && a.statut === 'success',
        ),
      ).toBeDefined();
    });

    it('ADMIN : POST code dupliqué → 409', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/configuration/type-structure')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ code: 'agence', libelle: 'Doublon' })
        .expect(409);
    });

    it('ADMIN : DELETE valeur estSysteme=true → 409', async () => {
      const list = await request(app.getHttpServer())
        .get('/api/v1/configuration/type-structure?estSysteme=true&limit=10')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const eju = list.body.items.find(
        (i: { code: string }) => i.code === 'entite_juridique',
      ) as { id: string };
      await request(app.getHttpServer())
        .delete(`/api/v1/configuration/type-structure/${eju.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(409);
    });

    it("ADMIN : DELETE 'agence' (estSysteme=false) référencée par dim_structure → 409", async () => {
      await seedDimStructureAgence(dataSource);
      const list = await request(app.getHttpServer())
        .get('/api/v1/configuration/type-structure')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const ag = list.body.items.find(
        (i: { code: string }) => i.code === 'agence',
      ) as { id: string };
      const r = await request(app.getHttpServer())
        .delete(`/api/v1/configuration/type-structure/${ag.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(409);
      expect(r.body.message).toMatch(/référencée/);
    });

    it("ADMIN : DELETE valeur custom non-référencée → 204", async () => {
      const c = await request(app.getHttpServer())
        .post('/api/v1/configuration/type-structure')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ code: 'succursale', libelle: 'Succursale' })
        .expect(201);
      await request(app.getHttpServer())
        .delete(`/api/v1/configuration/type-structure/${c.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(204);
    });

    it('ADMIN : toggle-actif sur valeur référencée → 200 + warning', async () => {
      await seedDimStructureAgence(dataSource);
      const list = await request(app.getHttpServer())
        .get('/api/v1/configuration/type-structure')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const ag = list.body.items.find(
        (i: { code: string }) => i.code === 'agence',
      ) as { id: string };
      const r = await request(app.getHttpServer())
        .post(`/api/v1/configuration/type-structure/${ag.id}/toggle-actif`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(201);
      expect(r.body.entity.estActif).toBe(false);
      expect(r.body.warning).toMatch(/dim_structure/);
    });

    it('ADMIN : PATCH libellé sur valeur estSysteme=true → 200 (autorisé)', async () => {
      const list = await request(app.getHttpServer())
        .get('/api/v1/configuration/type-structure?estSysteme=true&limit=10')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const eju = list.body.items.find(
        (i: { code: string }) => i.code === 'entite_juridique',
      ) as { id: string };
      const r = await request(app.getHttpServer())
        .patch(`/api/v1/configuration/type-structure/${eju.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ libelle: 'Entité juridique (modifiée)' })
        .expect(200);
      expect(r.body.libelle).toBe('Entité juridique (modifiée)');
    });

    it('ADMIN : PATCH code sur valeur estSysteme=true → 422', async () => {
      const list = await request(app.getHttpServer())
        .get('/api/v1/configuration/type-structure?estSysteme=true&limit=10')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const eju = list.body.items.find(
        (i: { code: string }) => i.code === 'entite_juridique',
      ) as { id: string };
      await request(app.getHttpServer())
        .patch(`/api/v1/configuration/type-structure/${eju.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ code: 'entite_renommee' })
        .expect(422);
    });

    it("GET par-code/agence → retourne la valeur", async () => {
      const r = await request(app.getHttpServer())
        .get('/api/v1/configuration/type-structure/par-code/agence')
        .set('Authorization', `Bearer ${lecteurToken}`)
        .expect(200);
      expect(r.body.code).toBe('agence');
    });

    it('GET par-code/inconnu → 404', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/configuration/type-structure/par-code/inconnu')
        .set('Authorization', `Bearer ${lecteurToken}`)
        .expect(404);
    });
  });

  // ─── ref_categorie_segment

  describe('ref_categorie_segment', () => {
    it('LECTEUR : GET → 6 valeurs', async () => {
      const r = await request(app.getHttpServer())
        .get('/api/v1/configuration/categorie-segment')
        .set('Authorization', `Bearer ${lecteurToken}`)
        .expect(200);
      expect(r.body.total).toBe(6);
    });

    it('Filtre estSysteme=true → 2 valeurs', async () => {
      const r = await request(app.getHttpServer())
        .get('/api/v1/configuration/categorie-segment?estSysteme=true')
        .set('Authorization', `Bearer ${lecteurToken}`)
        .expect(200);
      expect(r.body.total).toBe(2);
      expect(r.body.items.map((i: { code: string }) => i.code).sort()).toEqual([
        'institutionnel',
        'secteur_public',
      ]);
    });
  });

  // ─── ref_type_action_audit

  describe('ref_type_action_audit', () => {
    it('LECTEUR : GET → 14 valeurs toutes système', async () => {
      const r = await request(app.getHttpServer())
        .get('/api/v1/configuration/type-action-audit')
        .set('Authorization', `Bearer ${lecteurToken}`)
        .expect(200);
      expect(r.body.total).toBe(14);
      expect(
        r.body.items.every(
          (i: { estSysteme: boolean }) => i.estSysteme === true,
        ),
      ).toBe(true);
    });

    it("ADMIN : DELETE 'CREATE' (estSysteme=true) → 409", async () => {
      const list = await request(app.getHttpServer())
        .get('/api/v1/configuration/type-action-audit')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const c = list.body.items.find(
        (i: { code: string }) => i.code === 'CREATE',
      ) as { id: string };
      await request(app.getHttpServer())
        .delete(`/api/v1/configuration/type-action-audit/${c.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(409);
    });
  });

  // ─── Smoke test des 10 autres référentiels (couvre l'enregistrement
  //     Nest + le wiring du factory de controller).
  //     Les services sont vides en pg-mem (les seeds initiaux sont
  //     inline dans les migrations, non rejouées en pg-mem) — on
  //     vérifie juste que les routes répondent 200 + structure
  //     PaginatedRefSecondaireDto correcte.

  describe('smoke 10 référentiels restants', () => {
    const ROUTES_RESTANTS = [
      'pays',
      'type-cr',
      'sens-compte',
      'classe-compte',
      'type-produit',
      'type-version',
      'statut-version',
      'type-scenario',
      'statut-scenario',
      'type-taux',
    ];

    it.each(ROUTES_RESTANTS)(
      'GET /api/v1/configuration/%s → 200 (LECTEUR)',
      async (route) => {
        const r = await request(app.getHttpServer())
          .get(`/api/v1/configuration/${route}`)
          .set('Authorization', `Bearer ${lecteurToken}`)
          .expect(200);
        expect(r.body).toEqual(
          expect.objectContaining({
            items: expect.any(Array),
            total: expect.any(Number),
            page: 1,
            limit: 50,
          }),
        );
      },
    );

    it.each(ROUTES_RESTANTS)(
      'POST /api/v1/configuration/%s → 403 (LECTEUR)',
      async (route) => {
        await request(app.getHttpServer())
          .post(`/api/v1/configuration/${route}`)
          .set('Authorization', `Bearer ${lecteurToken}`)
          .send({ code: 'foo', libelle: 'Foo' })
          .expect(403);
      },
    );

    it('POST + DELETE valeur custom non-référencée sur ref_pays → 201 puis 204', async () => {
      const c = await request(app.getHttpServer())
        .post('/api/v1/configuration/pays')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ code: 'TST', libelle: 'Test' })
        .expect(201);
      expect(c.body.code).toBe('TST');
      await request(app.getHttpServer())
        .delete(`/api/v1/configuration/pays/${c.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(204);
    });
  });
});
