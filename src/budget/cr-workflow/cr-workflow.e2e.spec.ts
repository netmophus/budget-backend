/**
 * Tests e2e du cycle complet de validation par CR (Lot workflow CR).
 *
 * Via SuperTest HTTP réel (convention projet) : on exerce les endpoints
 * /api/v1/budget/cr/... + /referentiels/versions/:id/soumettre-comite
 * avec 3 personas (SAISISSEUR / VALIDATEUR / COORDINATEUR) et leurs
 * permissions + périmètres réels.
 *
 * 7 cas : soumettre→valider, rejet+correction, réouverture, bascule auto
 * PRE_VALIDE, réouverture→OUVERT, soumission Comité, verrou saisie (403).
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
import { CentreResponsabiliteModule } from '../../referentiels/centre-responsabilite/centre-responsabilite.module';
import { CompteModule } from '../../referentiels/compte/compte.module';
import { DeviseModule } from '../../referentiels/devise/devise.module';
import { LigneMetierModule } from '../../referentiels/ligne-metier/ligne-metier.module';
import { ProduitModule } from '../../referentiels/produit/produit.module';
import { ScenarioModule } from '../../referentiels/scenario/scenario.module';
import { SegmentModule } from '../../referentiels/segment/segment.module';
import { StructureModule } from '../../referentiels/structure/structure.module';
import { TauxChangeModule } from '../../referentiels/taux-change/taux-change.module';
import { TempsModule } from '../../referentiels/temps/temps.module';
import { VersionModule } from '../../referentiels/version/version.module';
import { RolesModule } from '../../roles/roles.module';
import { UsersModule } from '../../users/users.module';
import { BudgetModule } from '../budget.module';

const ids: Record<string, string> = {};

async function scalar(ds: DataSource, sql: string): Promise<string> {
  const r = (await ds.query(sql)) as Array<{ id: string | number }>;
  return String(r[0]!.id);
}

async function seed(ds: DataSource): Promise<void> {
  // Permissions + rôles + bridge
  for (const [code, mod] of [
    ['BUDGET.LIRE', 'BUDGET'],
    ['BUDGET.SAISIR', 'BUDGET'],
    ['BUDGET.SOUMETTRE', 'BUDGET'],
    ['BUDGET.VALIDER', 'BUDGET'],
    ['BUDGET.COORDONNER', 'BUDGET'],
  ]) {
    await ds.query(
      `INSERT INTO ref_permission (code_permission, libelle, module, utilisateur_creation)
       VALUES ($1, $1, $2, 'system')`,
      [code, mod],
    );
  }
  for (const [role, perms] of [
    ['SAISISSEUR', ['BUDGET.LIRE', 'BUDGET.SAISIR', 'BUDGET.SOUMETTRE']],
    ['VALIDATEUR', ['BUDGET.LIRE', 'BUDGET.VALIDER']],
    ['COORDINATEUR', ['BUDGET.LIRE', 'BUDGET.COORDONNER']],
  ] as Array<[string, string[]]>) {
    await ds.query(
      `INSERT INTO ref_role (code_role, libelle, est_actif, utilisateur_creation)
       VALUES ($1, $1, true, 'system')`,
      [role],
    );
    for (const p of perms) {
      await ds.query(
        `INSERT INTO bridge_role_permission (fk_role, fk_permission)
         VALUES ((SELECT id FROM ref_role WHERE code_role=$1),
                 (SELECT id FROM ref_permission WHERE code_permission=$2))`,
        [role, p],
      );
    }
  }
  // Users + bridge_user_role
  for (const [email, role] of [
    ['saisisseur@m.local', 'SAISISSEUR'],
    ['validateur@m.local', 'VALIDATEUR'],
    ['coordinateur@m.local', 'COORDINATEUR'],
  ]) {
    await ds.query(
      `INSERT INTO "user" (email, mot_de_passe_hash, nom, prenom, est_actif, utilisateur_creation)
       VALUES ($1, 'hash', 'N', 'P', true, 'system')`,
      [email],
    );
    await ds.query(
      `INSERT INTO bridge_user_role (fk_user, fk_role, perimetre_type, est_actif, utilisateur_creation)
       VALUES ((SELECT id FROM "user" WHERE email=$1),
               (SELECT id FROM ref_role WHERE code_role=$2), 'global', true, 'system')`,
      [email, role],
    );
  }
  ids.uSaisisseur = await scalar(
    ds,
    `SELECT id FROM "user" WHERE email='saisisseur@m.local'`,
  );
  ids.uValidateur = await scalar(
    ds,
    `SELECT id FROM "user" WHERE email='validateur@m.local'`,
  );
  ids.uCoordinateur = await scalar(
    ds,
    `SELECT id FROM "user" WHERE email='coordinateur@m.local'`,
  );

  // Dimensions
  await ds.query(
    `INSERT INTO dim_structure ("code_structure","libelle","libelle_court","type_structure","niveau_hierarchique","fk_structure_parent","code_pays","date_debut_validite","date_fin_validite","version_courante","est_actif","utilisateur_creation")
     VALUES ('AG','Agence',NULL,'agence',1,NULL,NULL,'2026-01-01',NULL,true,true,'system')`,
  );
  ids.struct = await scalar(
    ds,
    `SELECT id FROM dim_structure WHERE code_structure='AG'`,
  );
  await ds.query(
    `INSERT INTO dim_centre_responsabilite ("code_cr","libelle","libelle_court","type_cr","fk_structure","date_debut_validite","date_fin_validite","version_courante","est_actif","utilisateur_creation")
     VALUES ('CR_TEST','CR Test',NULL,'cdc',${ids.struct},'2026-01-01',NULL,true,true,'system')`,
  );
  ids.cr = await scalar(
    ds,
    `SELECT id FROM dim_centre_responsabilite WHERE code_cr='CR_TEST'`,
  );
  await ds.query(
    `INSERT INTO dim_compte ("code_compte","libelle","classe","fk_compte_parent","niveau","est_compte_collectif","est_porteur_interets","date_debut_validite","date_fin_validite","version_courante","est_actif","utilisateur_creation")
     VALUES ('611100','Salaires','6',NULL,4,false,false,'2026-01-01',NULL,true,true,'system')`,
  );
  ids.compte = await scalar(
    ds,
    `SELECT id FROM dim_compte WHERE code_compte='611100'`,
  );
  await ds.query(
    `INSERT INTO dim_ligne_metier ("code_ligne_metier","libelle","fk_ligne_metier_parent","niveau","date_debut_validite","date_fin_validite","version_courante","est_actif","utilisateur_creation")
     VALUES ('RETAIL','Retail',NULL,1,'2026-01-01',NULL,true,true,'system')`,
  );
  ids.lm = await scalar(
    ds,
    `SELECT id FROM dim_ligne_metier WHERE code_ligne_metier='RETAIL'`,
  );
  await ds.query(
    `INSERT INTO dim_produit ("code_produit","libelle","type_produit","fk_produit_parent","niveau","est_porteur_interets","date_debut_validite","date_fin_validite","version_courante","est_actif","utilisateur_creation")
     VALUES ('PRD','Produit','autre',NULL,1,false,'2026-01-01',NULL,true,true,'system')`,
  );
  ids.produit = await scalar(
    ds,
    `SELECT id FROM dim_produit WHERE code_produit='PRD'`,
  );
  await ds.query(
    `INSERT INTO dim_segment ("code_segment","libelle","categorie","date_debut_validite","date_fin_validite","version_courante","est_actif","utilisateur_creation")
     VALUES ('SEG','Segment','particulier','2026-01-01',NULL,true,true,'system')`,
  );
  ids.segment = await scalar(
    ds,
    `SELECT id FROM dim_segment WHERE code_segment='SEG'`,
  );
  await ds.query(
    `INSERT INTO dim_devise ("code_iso","libelle","symbole","nb_decimales","est_devise_pivot","est_active","utilisateur_creation")
     VALUES ('XOF','Franc CFA','F CFA',0,true,true,'system')`,
  );
  ids.devise = await scalar(
    ds,
    `SELECT id FROM dim_devise WHERE code_iso='XOF'`,
  );
  await ds.query(
    `INSERT INTO dim_temps ("date","annee","trimestre","mois","jour","jour_ouvre","est_fin_de_mois","est_fin_de_trimestre","est_fin_d_annee","exercice_fiscal","libelle_mois")
     VALUES ('2027-01-01',2027,1,1,1,true,false,false,false,2027,'Janvier')`,
  );
  ids.temps = await scalar(
    ds,
    `SELECT id FROM dim_temps WHERE date='2027-01-01'`,
  );
  await ds.query(
    `INSERT INTO dim_version ("code_version","libelle","type_version","exercice_fiscal","statut","utilisateur_creation")
     VALUES ('BUDGET_2027','Budget 2027','budget_initial',2027,'ouvert','system')`,
  );
  ids.version = await scalar(
    ds,
    `SELECT id FROM dim_version WHERE code_version='BUDGET_2027'`,
  );
  await ds.query(
    `INSERT INTO dim_scenario ("code_scenario","libelle","type_scenario","statut","exercice_fiscal","utilisateur_creation")
     VALUES ('MEDIAN','Médian','central','actif',2027,'system')`,
  );
  ids.scenario = await scalar(
    ds,
    `SELECT id FROM dim_scenario WHERE code_scenario='MEDIAN'`,
  );

  // Périmètres : saisisseur + validateur sur CR_TEST
  for (const uid of [ids.uSaisisseur, ids.uValidateur]) {
    await ds.query(
      `INSERT INTO user_perimetres ("fk_user","cible_type","cible_id","cible_cr_ids","origine","date_debut","date_fin","actif","utilisateur_creation")
       VALUES ($1,'CR_SET',NULL,$2,'AFFECTATION','2026-01-01',NULL,true,'system')`,
      [uid, [ids.cr]],
    );
  }
}

/** Réinitialise l'état workflow entre les tests (dims conservées). */
async function resetEtat(ds: DataSource): Promise<void> {
  await ds.query(`DELETE FROM fait_budget_cr_statut`);
  await ds.query(`DELETE FROM dim_version_cr_attendu`);
  await ds.query(`DELETE FROM fait_budget`);
  await ds.query(
    `UPDATE dim_version SET statut='ouvert' WHERE id=${ids.version}`,
  );
  // 1 ligne fait_budget pour CR_TEST (garde-fou soumettre)
  await ds.query(
    `INSERT INTO fait_budget ("fk_temps","fk_compte","fk_structure","fk_centre","fk_ligne_metier","fk_produit","fk_segment","fk_devise","fk_version","fk_scenario","montant_devise","montant_fcfa","taux_change_applique","mode_saisie","utilisateur_creation")
     VALUES (${ids.temps},${ids.compte},${ids.struct},${ids.cr},${ids.lm},${ids.produit},${ids.segment},${ids.devise},${ids.version},${ids.scenario},1000,1000,1,'MONTANT','system')`,
  );
  // Snapshot : CR_TEST seul attendu (1/1 → pré-validation possible)
  await ds.query(
    `INSERT INTO dim_version_cr_attendu ("fk_version","fk_cr","source","actif","utilisateur_creation")
     VALUES (${ids.version},${ids.cr},'AUTO',true,'system')`,
  );
}

describe('Workflow par CR (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let tokenSaisisseur: string;
  let tokenValidateur: string;
  let tokenCoordinateur: string;
  const VID = (): string => ids.version;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'test-secret-cr-workflow-e2e-min-32-chars-aaaaa';
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
            const d = memDb.adapters.createTypeormDataSource(
              options,
            ) as DataSource;
            await d.initialize();
            return d;
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
        TauxChangeModule,
        BudgetModule,
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

    ds = app.get(DataSource);
    const jwt = app.get(JwtService);
    await seed(ds);

    tokenSaisisseur = await jwt.signAsync({
      sub: ids.uSaisisseur,
      email: 'saisisseur@m.local',
      jti: 'jti-s',
    });
    tokenValidateur = await jwt.signAsync({
      sub: ids.uValidateur,
      email: 'validateur@m.local',
      jti: 'jti-v',
    });
    tokenCoordinateur = await jwt.signAsync({
      sub: ids.uCoordinateur,
      email: 'coordinateur@m.local',
      jti: 'jti-c',
    });
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  beforeEach(async () => {
    await resetEtat(ds);
  });

  const api = (): string => '/api/v1';
  const auth = (t: string): string => `Bearer ${t}`;

  async function versionStatut(): Promise<string> {
    const r = (await ds.query(
      `SELECT statut FROM dim_version WHERE id=${ids.version}`,
    )) as Array<{ statut: string }>;
    return r[0]!.statut;
  }

  // ─── Cas 1 : soumettre → valider → VALIDE ──────────────────────────
  it('Cas 1 : saisisseur soumet → validateur valide → CR VALIDE', async () => {
    const s = await request(app.getHttpServer())
      .post(`${api()}/budget/cr/CR_TEST/soumettre?versionId=${VID()}`)
      .set('Authorization', auth(tokenSaisisseur))
      .send({ commentaire: 'fini' });
    expect(s.status).toBe(200);
    expect(s.body.statut).toBe('SOUMIS');

    const v = await request(app.getHttpServer())
      .post(`${api()}/budget/cr/CR_TEST/valider?versionId=${VID()}`)
      .set('Authorization', auth(tokenValidateur))
      .send({});
    expect(v.status).toBe(200);
    expect(v.body.statut).toBe('VALIDE');
  });

  // ─── Cas 2 : rejet + correction + re-soumission ───────────────────
  it('Cas 2 : rejet avec motif → EN_SAISIE → re-soumission', async () => {
    await request(app.getHttpServer())
      .post(`${api()}/budget/cr/CR_TEST/soumettre?versionId=${VID()}`)
      .set('Authorization', auth(tokenSaisisseur))
      .send({});
    const r = await request(app.getHttpServer())
      .post(`${api()}/budget/cr/CR_TEST/rejeter?versionId=${VID()}`)
      .set('Authorization', auth(tokenValidateur))
      .send({ motif: 'Charges sous-évaluées' });
    expect(r.status).toBe(200);
    expect(r.body.statut).toBe('EN_SAISIE');
    expect(r.body.motifRejet).toBe('Charges sous-évaluées');

    const r2 = await request(app.getHttpServer())
      .post(`${api()}/budget/cr/CR_TEST/soumettre?versionId=${VID()}`)
      .set('Authorization', auth(tokenSaisisseur))
      .send({});
    expect(r2.status).toBe(200);
    expect(r2.body.statut).toBe('SOUMIS');
  });

  // ─── Cas 2b : rejet sans motif → 400 ──────────────────────────────
  it('Cas 2b : rejet sans motif → 400', async () => {
    await request(app.getHttpServer())
      .post(`${api()}/budget/cr/CR_TEST/soumettre?versionId=${VID()}`)
      .set('Authorization', auth(tokenSaisisseur))
      .send({});
    const r = await request(app.getHttpServer())
      .post(`${api()}/budget/cr/CR_TEST/rejeter?versionId=${VID()}`)
      .set('Authorization', auth(tokenValidateur))
      .send({});
    expect(r.status).toBe(400);
  });

  // ─── Cas 3 : réouverture d'un CR validé ───────────────────────────
  it('Cas 3 : validateur valide puis rouvre → EN_SAISIE', async () => {
    await request(app.getHttpServer())
      .post(`${api()}/budget/cr/CR_TEST/soumettre?versionId=${VID()}`)
      .set('Authorization', auth(tokenSaisisseur))
      .send({});
    await request(app.getHttpServer())
      .post(`${api()}/budget/cr/CR_TEST/valider?versionId=${VID()}`)
      .set('Authorization', auth(tokenValidateur))
      .send({});
    const ro = await request(app.getHttpServer())
      .post(`${api()}/budget/cr/CR_TEST/rouvrir?versionId=${VID()}`)
      .set('Authorization', auth(tokenValidateur))
      .send({ motif: 'Erreur détectée' });
    expect(ro.status).toBe(200);
    expect(ro.body.statut).toBe('EN_SAISIE');
  });

  // ─── Cas 4 : bascule auto OUVERT → PRE_VALIDE ─────────────────────
  it('Cas 4 : tous les CR attendus validés → version PRE_VALIDE', async () => {
    await request(app.getHttpServer())
      .post(`${api()}/budget/cr/CR_TEST/soumettre?versionId=${VID()}`)
      .set('Authorization', auth(tokenSaisisseur))
      .send({});
    await request(app.getHttpServer())
      .post(`${api()}/budget/cr/CR_TEST/valider?versionId=${VID()}`)
      .set('Authorization', auth(tokenValidateur))
      .send({});
    expect(await versionStatut()).toBe('pre_valide');
  });

  // ─── Cas 5 : réouverture après PRE_VALIDE → version OUVERT ─────────
  it('Cas 5 : réouverture après PRE_VALIDE → version repasse OUVERT', async () => {
    await request(app.getHttpServer())
      .post(`${api()}/budget/cr/CR_TEST/soumettre?versionId=${VID()}`)
      .set('Authorization', auth(tokenSaisisseur))
      .send({});
    await request(app.getHttpServer())
      .post(`${api()}/budget/cr/CR_TEST/valider?versionId=${VID()}`)
      .set('Authorization', auth(tokenValidateur))
      .send({});
    expect(await versionStatut()).toBe('pre_valide');
    await request(app.getHttpServer())
      .post(`${api()}/budget/cr/CR_TEST/rouvrir?versionId=${VID()}`)
      .set('Authorization', auth(tokenValidateur))
      .send({ motif: 'Révision' });
    expect(await versionStatut()).toBe('ouvert');
  });

  // ─── Cas 6 : Coordinateur soumet au Comité ────────────────────────
  it('Cas 6 : Coordinateur soumet PRE_VALIDE → SOUMIS_COMITE', async () => {
    await ds.query(
      `UPDATE dim_version SET statut='pre_valide' WHERE id=${ids.version}`,
    );
    const c = await request(app.getHttpServer())
      .post(`${api()}/referentiels/versions/${VID()}/soumettre-comite`)
      .set('Authorization', auth(tokenCoordinateur))
      .send({});
    expect(c.status).toBe(200);
    expect(c.body.statut).toBe('soumis_comite');
  });

  // ─── Cas 6b : un saisisseur ne peut PAS soumettre au Comité (403) ─
  it('Cas 6b : saisisseur sans BUDGET.COORDONNER → 403 sur soumettre-comite', async () => {
    await ds.query(
      `UPDATE dim_version SET statut='pre_valide' WHERE id=${ids.version}`,
    );
    const c = await request(app.getHttpServer())
      .post(`${api()}/referentiels/versions/${VID()}/soumettre-comite`)
      .set('Authorization', auth(tokenSaisisseur))
      .send({});
    expect(c.status).toBe(403);
  });

  // ─── Cas 7 : verrou saisie sur CR SOUMIS → 403 CR_VERROUILLE ───────
  it('Cas 7 : saisie sur un CR SOUMIS → 403 CR_VERROUILLE', async () => {
    await request(app.getHttpServer())
      .post(`${api()}/budget/cr/CR_TEST/soumettre?versionId=${VID()}`)
      .set('Authorization', auth(tokenSaisisseur))
      .send({});
    const save = await request(app.getHttpServer())
      .post(`${api()}/budget/grille`)
      .set('Authorization', auth(tokenSaisisseur))
      .send({
        versionId: ids.version,
        scenarioId: ids.scenario,
        crId: ids.cr,
        lignes: [
          {
            compteId: ids.compte,
            ligneMetierId: ids.lm,
            cellules: [
              { mois: '2027-01-01', montant: 500, modeSaisie: 'MONTANT' },
            ],
          },
        ],
      });
    expect(save.status).toBe(403);
    expect(JSON.stringify(save.body)).toContain('CR_VERROUILLE');
  });
});
