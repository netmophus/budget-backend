/**
 * Teardown global Jest e2e — arrête les containers Postgres + Redis
 * démarrés par setup-global.ts.
 */
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { StartedTestContainer } from 'testcontainers';

declare global {
  // eslint-disable-next-line no-var
  var __E2E_PG_CONTAINER__: StartedPostgreSqlContainer | undefined;
  // eslint-disable-next-line no-var
  var __E2E_REDIS_CONTAINER__: StartedTestContainer | undefined;
}

export default async function globalTeardown(): Promise<void> {
  const stops: Array<Promise<unknown>> = [];
  const pg = globalThis.__E2E_PG_CONTAINER__;
  const redis = globalThis.__E2E_REDIS_CONTAINER__;
  if (pg) stops.push(pg.stop({ remove: true }));
  if (redis) stops.push(redis.stop({ remove: true }));
  await Promise.all(stops);
  globalThis.__E2E_PG_CONTAINER__ = undefined;
  globalThis.__E2E_REDIS_CONTAINER__ = undefined;
}
