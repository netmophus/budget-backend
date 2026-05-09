/**
 * Teardown global Jest e2e — arrête le container Postgres démarré par
 * setup-global.ts.
 */
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';

declare global {
  // eslint-disable-next-line no-var
  var __E2E_PG_CONTAINER__: StartedPostgreSqlContainer | undefined;
}

export default async function globalTeardown(): Promise<void> {
  const container = globalThis.__E2E_PG_CONTAINER__;
  if (container) {
    await container.stop({ remove: true });
    globalThis.__E2E_PG_CONTAINER__ = undefined;
  }
}
