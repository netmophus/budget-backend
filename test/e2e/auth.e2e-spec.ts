/**
 * E2E.1 — Auth + RBAC bout-en-bout.
 *
 * Couvre :
 *  - login admin → 200 + JWT
 *  - GET /users/me/permissions avec JWT → liste de permissions
 *  - login lecteur → 200
 *  - POST /admin/users avec JWT lecteur → 403 (LECTEUR n'a pas USER.GERER)
 *  - login user inexistant → 401
 *  - refresh token valide → 200 + nouveau couple access/refresh
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { bootstrapApp } from './helpers/app';
import { bearer, login, PERSONAS } from './helpers/auth';

describe('E2E.1 — Auth + RBAC', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await bootstrapApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('admin se connecte et récupère un JWT', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send(PERSONAS.ADMIN)
      .expect(200);

    expect(res.body).toMatchObject({
      accessToken: expect.any(String),
      refreshToken: expect.any(String),
      user: {
        id: expect.any(String),
        email: 'admin@miznas.local',
      },
    });
  });

  it('GET /users/me/permissions avec JWT admin renvoie une liste non vide', async () => {
    const session = await login(
      app,
      PERSONAS.ADMIN.email,
      PERSONAS.ADMIN.motDePasse,
    );

    const res = await request(app.getHttpServer())
      .get('/api/v1/users/me/permissions')
      .set(bearer(session))
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    const codes: string[] = res.body.map(
      (p: { code_permission: string }) => p.code_permission,
    );
    // L'admin a SYSTEM.ADMIN dans le seed.
    expect(codes).toContain('SYSTEM.ADMIN');
  });

  it('lecteur se connecte avec succès', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send(PERSONAS.LECTEUR)
      .expect(200);

    expect(res.body.user.email).toBe('lecteur@miznas.local');
  });

  it('POST /admin/users avec JWT lecteur → 403 (USER.GERER manquant)', async () => {
    const session = await login(
      app,
      PERSONAS.LECTEUR.email,
      PERSONAS.LECTEUR.motDePasse,
    );

    await request(app.getHttpServer())
      .post('/api/v1/admin/users')
      .set(bearer(session))
      .send({
        email: 'tentative@miznas.local',
        motDePasse: 'TentativeInterdite!2026',
        nom: 'Tentative',
        prenom: 'Interdite',
        roleIds: ['1'],
      })
      .expect(403);
  });

  it('login user inexistant → 401', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'inconnu@miznas.local', motDePasse: 'Inexistant!2026' })
      .expect(401);
  });

  it('refresh token valide → 200 + nouveau couple access/refresh', async () => {
    const session = await login(
      app,
      PERSONAS.ADMIN.email,
      PERSONAS.ADMIN.motDePasse,
    );

    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: session.refreshToken })
      .expect(200);

    expect(res.body).toMatchObject({
      accessToken: expect.any(String),
      refreshToken: expect.any(String),
    });
    // Le nouveau access token doit être différent de l'ancien (rotation).
    expect(res.body.accessToken).not.toBe(session.accessToken);
  });
});
