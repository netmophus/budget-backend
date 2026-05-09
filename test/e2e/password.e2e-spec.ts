/**
 * E2E.8 — Flux complet doit_changer_mdp + PATCH /me/password (Lot 6.4.A).
 *
 * Couvre :
 *  - login d'un user dont `doit_changer_mdp = true` → flag retourné
 *  - tentative d'accès à un endpoint normal avec ce JWT → 403 MDP_TEMPORAIRE
 *  - PATCH /me/password avec ancien + nouveau valide → 200 + nouveaux tokens
 *  - login suivant avec le nouveau mdp → flag false
 *  - audit_log : 2 entrées PASSWORD_CHANGED (1 pour le test du flow)
 *
 * Le user est mis à doit_changer_mdp=true via SQL direct (in-process,
 * pré-requis ≠ objet du test) — l'objet du test passe par HTTP réel
 * (login + PATCH /me/password + accès endpoint).
 */
import { type INestApplication } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import type { DataSource } from 'typeorm';

import { bootstrapApp } from './helpers/app';
import { PERSONAS } from './helpers/auth';

describe('E2E.8 — Flux force change mot de passe', () => {
  let app: INestApplication;
  let ds: DataSource;
  // Le persona BSIC adj.retail est seedé avec mdp MiznasTest!2026 (cf.
  // migration 1779200000090). On l'utilise sans toucher aux personas
  // utilisés par d'autres specs (admin / lecteur / controleur.gestion).
  const persona = PERSONAS.ADJ_RETAIL;

  beforeAll(async () => {
    app = await bootstrapApp();
    ds = app.get<DataSource>(getDataSourceToken());
  });

  // Lot 6.4.A — reset l'état du persona AVANT CHAQUE test (mdp seed
  // + flags clean). Indispensable car le test 1 mute le mdp via PATCH
  // /me/password : sans reset, les tests 2 et 3 voient l'ancien mdp
  // changé et leur login échoue (401). `beforeEach` s'exécute aussi
  // avant le 1er test → couvre aussi un éventuel pollutant d'un spec
  // précédent.
  beforeEach(async () => {
    const hash = await bcrypt.hash(persona.motDePasse, 4);
    await ds.query(
      `UPDATE "user"
          SET mot_de_passe_hash = $1,
              doit_changer_mdp = false,
              date_expiration_mdp = NULL
        WHERE email = $2`,
      [hash, persona.email],
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('flux complet : doit_changer_mdp → 403 → PATCH /me/password → 200 → endpoint accessible', async () => {
    // 1. Forcer doit_changer_mdp=true en SQL (simule un reset admin).
    await ds.query(
      `UPDATE "user" SET doit_changer_mdp = true WHERE email = $1`,
      [persona.email],
    );

    // 2. Login → la réponse contient doitChangerMdp=true.
    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send(persona)
      .expect(200);
    expect(loginRes.body.doitChangerMdp).toBe(true);
    expect(loginRes.body.mdpExpire).toBe(false);
    const oldAccessToken: string = loginRes.body.accessToken;

    // 3. Avec ce JWT, GET /users/me/permissions doit être bloqué par
    //    PasswordExpiredGuard avec code MDP_TEMPORAIRE.
    const blocked = await request(app.getHttpServer())
      .get('/api/v1/users/me/permissions')
      .set('Authorization', `Bearer ${oldAccessToken}`);
    expect(blocked.status).toBe(403);
    // Lot 6.4.A : le AllExceptionsFilter normalise le payload en
    // { statusCode, message, errorCode, timestamp, path }. Le `code`
    // applicatif posé par PasswordExpiredGuard est préservé dans
    // `errorCode` (et non dans une clé `code` à la racine).
    expect(blocked.body).toEqual(
      expect.objectContaining({ errorCode: 'MDP_TEMPORAIRE' }),
    );

    // 4. PATCH /me/password avec un nouveau mdp valide.
    const nouveauMdp = 'NouveauValide99@e2e';
    const patchRes = await request(app.getHttpServer())
      .patch('/api/v1/me/password')
      .set('Authorization', `Bearer ${oldAccessToken}`)
      .send({ ancienMdp: persona.motDePasse, nouveauMdp })
      .expect(200);
    expect(patchRes.body.doitChangerMdp).toBe(false);
    expect(patchRes.body.mdpExpire).toBe(false);
    expect(typeof patchRes.body.accessToken).toBe('string');
    expect(patchRes.body.accessToken).not.toBe(oldAccessToken);
    const newAccessToken: string = patchRes.body.accessToken;

    // 5. Avec les nouveaux tokens, l'endpoint normal est accessible.
    await request(app.getHttpServer())
      .get('/api/v1/users/me/permissions')
      .set('Authorization', `Bearer ${newAccessToken}`)
      .expect(200);

    // 6. Login suivant avec le nouveau mdp → flag false côté DB.
    const login2 = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: persona.email, motDePasse: nouveauMdp })
      .expect(200);
    expect(login2.body.doitChangerMdp).toBe(false);

    // 7. audit_log trace bien le PASSWORD_CHANGED réussi.
    const audits = (await ds.query(
      `SELECT type_action, statut FROM audit_log
        WHERE utilisateur = $1 AND type_action = 'PASSWORD_CHANGED'
          AND statut = 'success'`,
      [persona.email],
    )) as Array<{ type_action: string; statut: string }>;
    expect(audits.length).toBeGreaterThanOrEqual(1);
  });

  it('PATCH /me/password rejette un nouveau mdp non conforme (politique)', async () => {
    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send(persona)
      .expect(200);
    const token: string = loginRes.body.accessToken;

    // Mdp trop court → 400 + message politique.
    const res = await request(app.getHttpServer())
      .patch('/api/v1/me/password')
      .set('Authorization', `Bearer ${token}`)
      .send({ ancienMdp: persona.motDePasse, nouveauMdp: 'court' })
      .expect(400);
    expect(JSON.stringify(res.body)).toMatch(
      /12 caractères|majuscule|chiffre|spécial/,
    );
  });

  it('PATCH /me/password rejette un ancien mdp incorrect (401)', async () => {
    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send(persona)
      .expect(200);
    const token: string = loginRes.body.accessToken;

    await request(app.getHttpServer())
      .patch('/api/v1/me/password')
      .set('Authorization', `Bearer ${token}`)
      .send({
        ancienMdp: 'MauvaisAncien1!@#$',
        nouveauMdp: 'NouveauValide99@diff',
      })
      .expect(401);
  });
});
