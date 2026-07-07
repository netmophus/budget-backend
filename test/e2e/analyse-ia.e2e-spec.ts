/**
 * E2E — Chantier C1 : historisation des analyses IA.
 *
 * Vérifie le cycle complet en dry-run (AI_DRY_RUN par défaut, pas d'appel
 * réseau) : POST /tableau-de-bord/analyse-ai persiste l'analyse, puis
 * GET /analyses-ia la retrouve, GET /analyses-ia/:id renvoie le markdown,
 * DELETE la supprime (ADMIN a AI.HISTORIQUE), et un LECTEUR sans
 * AI.ANALYSER est refusé (403).
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { bootstrapApp } from './helpers/app';
import { type AuthSession, bearer, login, PERSONAS } from './helpers/auth';
import { getScenarioId, getVersionId } from './fixtures/referentiels';

describe('E2E — historisation analyses IA (Chantier C1)', () => {
  let app: INestApplication;
  let admin: AuthSession;
  let versionId: string;
  let scenarioId: string;

  beforeAll(async () => {
    app = await bootstrapApp();
    admin = await login(app, PERSONAS.ADMIN.email, PERSONAS.ADMIN.motDePasse);
    versionId = await getVersionId(app, 'BUDGET_INITIAL_2026');
    scenarioId = await getScenarioId(app, 'CENTRAL');
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST analyse-ai persiste → GET /analyses-ia la retrouve → détail', async () => {
    const post = await request(app.getHttpServer())
      .post('/api/v1/tableau-de-bord/analyse-ai')
      .send({ versionId, scenarioId, moisDebut: '2027-01', moisFin: '2027-03' })
      .set(bearer(admin))
      .expect(200);
    expect(post.body.analyse).toBeTruthy();

    const liste = await request(app.getHttpServer())
      .get('/api/v1/analyses-ia')
      .set(bearer(admin))
      .expect(200);
    expect(liste.body.total).toBeGreaterThanOrEqual(1);
    const item = liste.body.items[0];
    expect(item.demandeurEmail).toBe(PERSONAS.ADMIN.email);
    expect(item.resume).toBeTruthy();
    expect(item.reponseMarkdown).toBeUndefined(); // liste = sans markdown

    const detail = await request(app.getHttpServer())
      .get(`/api/v1/analyses-ia/${item.id}`)
      .set(bearer(admin))
      .expect(200);
    expect(detail.body.reponseMarkdown).toBe(post.body.analyse);
    expect(detail.body.kpiSnapshot).toBeDefined();
  });

  it('DELETE une analyse (ADMIN porte AI.HISTORIQUE) → 200', async () => {
    const liste = await request(app.getHttpServer())
      .get('/api/v1/analyses-ia')
      .set(bearer(admin))
      .expect(200);
    const id = liste.body.items[0].id as string;
    await request(app.getHttpServer())
      .delete(`/api/v1/analyses-ia/${id}`)
      .set(bearer(admin))
      .expect(200);
  });

  it('LECTEUR sans AI.ANALYSER → 403 sur GET /analyses-ia', async () => {
    const lecteur = await login(
      app,
      PERSONAS.LECTEUR.email,
      PERSONAS.LECTEUR.motDePasse,
    );
    await request(app.getHttpServer())
      .get('/api/v1/analyses-ia')
      .set(bearer(lecteur))
      .expect(403);
  });
});
