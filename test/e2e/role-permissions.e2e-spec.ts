/**
 * E2E — Édition de la matrice rôle × permission (PR A, HTTP réel + DB réelle).
 *
 * Couvre les 3 cas du brief PR A via SuperTest :
 *  - POST /roles/:id/permissions SANS ROLE.GERER (LECTEUR) → 403
 *  - POST /roles/:id/permissions AVEC ROLE.GERER (ADMIN)   → 200 (deja=false)
 *  - DELETE /roles/:id/permissions/:permId avec garde-fou
 *    (ADMIN retire SYSTEM.ADMIN du rôle ADMIN)             → 403
 *
 * Les IDs de rôles/permissions sont résolus dynamiquement via GET /roles
 * (ROLE.LIRE porté par l'admin) plutôt que codés en dur : le seed peut
 * réordonner les bigserial.
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { bootstrapApp } from './helpers/app';
import { type AuthSession, bearer, login, PERSONAS } from './helpers/auth';

interface PermissionLite {
  id: string;
  codePermission: string;
}
interface RoleLite {
  id: string;
  codeRole: string;
  permissions: PermissionLite[];
}

describe('E2E — Matrice rôle × permission (PR A)', () => {
  let app: INestApplication;
  let adminSession: AuthSession;
  let lecteurSession: AuthSession;

  let roleAdmin: RoleLite;
  let roleLecteur: RoleLite;
  let permSystemAdmin: PermissionLite;
  /** Permission portée par ADMIN mais absente de LECTEUR (ajout sans no-op). */
  let permAjoutable: PermissionLite;

  beforeAll(async () => {
    app = await bootstrapApp();
    adminSession = await login(
      app,
      PERSONAS.ADMIN.email,
      PERSONAS.ADMIN.motDePasse,
    );
    lecteurSession = await login(
      app,
      PERSONAS.LECTEUR.email,
      PERSONAS.LECTEUR.motDePasse,
    );

    const res = await request(app.getHttpServer())
      .get('/api/v1/roles')
      .set(bearer(adminSession))
      .expect(200);
    const roles = res.body as RoleLite[];

    roleAdmin = roles.find((r) => r.codeRole === 'ADMIN')!;
    roleLecteur = roles.find((r) => r.codeRole === 'LECTEUR')!;
    expect(roleAdmin).toBeDefined();
    expect(roleLecteur).toBeDefined();

    permSystemAdmin = roleAdmin.permissions.find(
      (p) => p.codePermission === 'SYSTEM.ADMIN',
    )!;
    expect(permSystemAdmin).toBeDefined();

    const codesLecteur = new Set(
      roleLecteur.permissions.map((p) => p.codePermission),
    );
    permAjoutable = roleAdmin.permissions.find(
      (p) => !codesLecteur.has(p.codePermission),
    )!;
    expect(permAjoutable).toBeDefined();
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /roles/:id/permissions sans ROLE.GERER (LECTEUR) → 403', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/roles/${roleLecteur.id}/permissions`)
      .set(bearer(lecteurSession))
      .send({ fkPermission: permAjoutable.id })
      .expect(403);
  });

  it('POST /roles/:id/permissions avec ROLE.GERER (ADMIN) → 200', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/roles/${roleLecteur.id}/permissions`)
      .set(bearer(adminSession))
      .send({ fkPermission: permAjoutable.id })
      .expect(200);
    expect(res.body.deja).toBe(false);
    expect(res.body.codePermission).toBe(permAjoutable.codePermission);
    expect(res.body.codeRole).toBe('LECTEUR');
  });

  it('POST idempotent : ré-ajout du même lien → 200 deja=true', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/roles/${roleLecteur.id}/permissions`)
      .set(bearer(adminSession))
      .send({ fkPermission: permAjoutable.id })
      .expect(200);
    expect(res.body.deja).toBe(true);
  });

  it('DELETE garde-fou : ADMIN retire SYSTEM.ADMIN du rôle ADMIN → 403', async () => {
    await request(app.getHttpServer())
      .delete(`/api/v1/roles/${roleAdmin.id}/permissions/${permSystemAdmin.id}`)
      .set(bearer(adminSession))
      .expect(403);
  });

  it('DELETE nominal : retrait du lien fraîchement ajouté à LECTEUR → 200', async () => {
    const res = await request(app.getHttpServer())
      .delete(`/api/v1/roles/${roleLecteur.id}/permissions/${permAjoutable.id}`)
      .set(bearer(adminSession))
      .expect(200);
    expect(res.body.deja).toBe(false);
  });
});
