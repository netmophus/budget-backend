/**
 * Setup global Jest e2e — démarre un Postgres 18 éphémère via
 * testcontainers, exécute les migrations en 2 phases (autour du seed
 * auth, qui doit avoir tourné avant la migration 1779200000090
 * AjouterPersonasBSIC qui dépend du rôle LECTEUR), puis seed les
 * référentiels minimaux.
 *
 * Variables d'env exposées à toutes les suites Jest :
 *   DB_HOST / DB_PORT / DB_USER / DB_PASSWORD / DB_NAME
 *   JWT_SECRET, NODE_ENV=test, BCRYPT_ROUNDS=4 (rapide), EMAIL_DRY_RUN=true
 *
 * Le container PG est conservé sur globalThis pour teardown-global.ts.
 *
 * Coût : ~30s au premier run (pull image postgres:18-alpine + démarrage).
 * Utilise `withReuse()` pour accélérer les runs locaux successifs.
 */
import 'reflect-metadata';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import * as path from 'path';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { DataSource } from 'typeorm';

import { seedAuth } from '../../src/seeds/auth-seed';
import { seedTemps } from '../../src/seeds/temps-seed';
import { seedDevises } from '../../src/seeds/devise-seed';
import { seedStructures } from '../../src/seeds/structure-seed';
import { seedCrs } from '../../src/seeds/cr-seed';
import { seedComptes } from '../../src/seeds/compte-seed';
import { seedLignesMetier } from '../../src/seeds/ligne-metier-seed';
import { seedProduits } from '../../src/seeds/produit-seed';
import { seedSegments } from '../../src/seeds/segment-seed';
import { seedVersions } from '../../src/seeds/version-seed';
import { seedScenarios } from '../../src/seeds/scenario-seed';

/** Timestamp de la migration AjouterPersonasBSIC qui suppose LECTEUR existant. */
const SEED_AUTH_BEFORE_TIMESTAMP = 1779200000090;

/**
 * Extrait le timestamp (13 chiffres) du nom de la classe TypeORM
 * (e.g. "InitAuthSchema1777384329141" → 1777384329141). Les instances
 * n'exposent pas `timestamp` directement.
 */
function migrationTimestamp(m: { name?: string; constructor?: { name: string } }): number {
  const name = m.name ?? m.constructor?.name ?? '';
  const match = /(\d{13})$/.exec(name);
  return match ? Number(match[1]) : 0;
}

declare global {
  // eslint-disable-next-line no-var
  var __E2E_PG_CONTAINER__: StartedPostgreSqlContainer | undefined;
  // eslint-disable-next-line no-var
  var __E2E_REDIS_CONTAINER__: StartedTestContainer | undefined;
}

export default async function globalSetup(): Promise<void> {
  const t0 = Date.now();
  // eslint-disable-next-line no-console
  console.log(
    '[e2e:setup] démarrage containers Postgres 18 + Redis 7 (testcontainers)',
  );

  // Démarrage des 2 containers en parallèle (pas de dépendance entre eux).
  const [container, redisContainer] = await Promise.all([
    new PostgreSqlContainer('postgres:18-alpine')
      .withDatabase('miznas_e2e')
      .withUsername('miznas')
      .withPassword('miznas')
      .start(),
    new GenericContainer('redis:7-alpine').withExposedPorts(6379).start(),
  ]);

  const host = container.getHost();
  const port = container.getMappedPort(5432);
  const user = container.getUsername();
  const password = container.getPassword();
  const database = container.getDatabase();
  const redisHost = redisContainer.getHost();
  const redisPort = redisContainer.getMappedPort(6379);

  // Variables d'env exposées à toutes les suites Jest. ConfigService
  // (NestJS) lira ces valeurs au bootstrap de l'app dans helpers/app.ts.
  process.env.DB_HOST = host;
  process.env.DB_PORT = String(port);
  process.env.DB_USER = user;
  process.env.DB_PASSWORD = password;
  process.env.DB_NAME = database;
  process.env.JWT_SECRET =
    process.env.JWT_SECRET ?? 'e2e-jwt-secret-' + 'x'.repeat(80);
  process.env.JWT_ACCESS_EXPIRES_IN = process.env.JWT_ACCESS_EXPIRES_IN ?? '15m';
  process.env.JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN ?? '7d';
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? 'silent';
  process.env.BCRYPT_ROUNDS = '4';
  process.env.EMAIL_DRY_RUN = 'true';
  // Lot 6.4.B — désactive le rate limiting login par défaut en e2e
  // car plusieurs specs (auth, password, perimetres-delegations,
  // emails) font 6+ logins successifs depuis la même IP. Le test
  // dédié rate-limit.e2e-spec.ts override temporairement à 'false'.
  process.env.LOGIN_RATE_LIMIT_DISABLED = 'true';
  process.env.SMTP_FROM = process.env.SMTP_FROM ?? 'miznas-e2e@local';
  process.env.APP_BASE_URL = process.env.APP_BASE_URL ?? 'http://localhost:5173';
  // Lot 6.3 — connexion Redis pour BullMQ (queue 'emails').
  process.env.REDIS_HOST = redisHost;
  process.env.REDIS_PORT = String(redisPort);

  // DataSource dédié au bootstrap (pas le AppDataSource singleton).
  // Glob non-récursif sur src/migrations/ pour exclure src/migrations/__tests__/.
  // Forward slashes obligatoires : sous Windows, path.join retourne des
  // backslashes que le glob TypeORM ne reconnaît pas → 0 migrations chargées.
  const migrationsGlob = path
    .join(__dirname, '..', '..', 'src', 'migrations')
    .replace(/\\/g, '/');
  const ds = new DataSource({
    type: 'postgres',
    host,
    port,
    username: user,
    password,
    database,
    migrations: [`${migrationsGlob}/*.ts`, `${migrationsGlob}/*.js`],
    entities: [],
    synchronize: false,
    logging: false,
  });

  await ds.initialize();

  // Découpe des migrations autour du seed auth.
  const allMigrations = [...ds.migrations];
  if (allMigrations.length === 0) {
    throw new Error(
      `[e2e:setup] aucune migration chargée — glob "${migrationsGlob}/*.ts" probablement incorrect.`,
    );
  }
  const phase1 = allMigrations.filter(
    (m) => migrationTimestamp(m) < SEED_AUTH_BEFORE_TIMESTAMP,
  );
  const phase2 = allMigrations.filter(
    (m) => migrationTimestamp(m) >= SEED_AUTH_BEFORE_TIMESTAMP,
  );
  // eslint-disable-next-line no-console
  console.log(
    `[e2e:setup] migrations chargées : ${allMigrations.length} (phase1=${phase1.length}, phase2=${phase2.length})`,
  );

  // Phase 1 : migrations qui créent les tables (jusqu'à 1779200000089).
  ds.migrations.length = 0;
  ds.migrations.push(...phase1);
  await ds.runMigrations({ transaction: 'each' });

  // Seed auth : permissions de base + rôles ADMIN/LECTEUR + users
  // admin@miznas.local + lecteur@miznas.local. Doit tourner AVANT la
  // migration 1779200000090 qui suppose ref_role.LECTEUR existant.
  await seedAuth(ds);

  // Phase 2 : migrations qui ajoutent les personas BSIC, rôles métier,
  // permissions REALISE/REFORECAST/DELEGATION, etc. (>= 1779200000090).
  ds.migrations.length = 0;
  ds.migrations.push(...phase2);
  await ds.runMigrations({ transaction: 'each' });

  // Restaurer le tableau complet par hygiène.
  ds.migrations.length = 0;
  ds.migrations.push(...allMigrations);

  // Seeds référentiels minimaux pour les scénarios e2e.
  await seedTemps(ds);
  await seedDevises(ds);
  await seedStructures(ds);
  await seedCrs(ds);
  await seedComptes(ds);
  await seedLignesMetier(ds);
  await seedProduits(ds);
  await seedSegments(ds);
  await seedVersions(ds);
  await seedScenarios(ds);

  await ds.destroy();

  globalThis.__E2E_PG_CONTAINER__ = container;
  globalThis.__E2E_REDIS_CONTAINER__ = redisContainer;

  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  // eslint-disable-next-line no-console
  console.log(
    `[e2e:setup] prêt en ${dt}s (pg=${host}:${port}/${database} redis=${redisHost}:${redisPort})`,
  );
}
