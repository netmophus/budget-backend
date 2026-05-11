/**
 * E2E.3 — Sérialisation crIds tableau de bord (régression Lot 5.2-fix1
 * et 5.2-fix2).
 *
 * Le tableau de bord accepte 4 variantes de sérialisation crIds via
 * query string. Les fixs 5.2-fix1 (whitelist:true strippait
 * silencieusement) et 5.2-fix2 (crIds scalaire vs array dans le DTO)
 * auraient été détectés par ce test. L'objectif n'est pas de valider
 * les chiffres mais que chaque variante est :
 *   1. parsée sans erreur 400 (sérialisation OK)
 *   2. produit une réponse 200 avec la shape attendue
 *
 * Permissions controleur.gestion = VALIDATEUR :
 *   BUDGET.LIRE ✓ + REALISE.LIRE ✓ → @RequirePermissions({ all: [...] })
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { bootstrapApp } from './helpers/app';
import { type AuthSession, bearer, login, PERSONAS } from './helpers/auth';
import { getCrId, getScenarioId, getVersionId } from './fixtures/referentiels';

describe('E2E.3 — Sérialisation crIds tableau de bord', () => {
  let app: INestApplication;
  let session: AuthSession;
  let versionId: string;
  let scenarioId: string;
  let crId1: string;
  let crId2: string;

  beforeAll(async () => {
    app = await bootstrapApp();
    session = await login(
      app,
      PERSONAS.CONTROLEUR_GESTION.email,
      PERSONAS.CONTROLEUR_GESTION.motDePasse,
    );
    versionId = await getVersionId(app, 'BUDGET_INITIAL_2026');
    scenarioId = await getScenarioId(app, 'CENTRAL');
    crId1 = await getCrId(app, 'CR_AG_ABJ_PLATEAU');
    crId2 = await getCrId(app, 'CR_AG_ABJ_COCODY');
  });

  afterAll(async () => {
    await app.close();
  });

  function expectShape(body: unknown): void {
    expect(body).toEqual(
      expect.objectContaining({
        filtres: expect.any(Object),
        kpi: expect.any(Object),
        lignes: expect.any(Array),
      }),
    );
  }

  it('crIds scalaire (crIds=<id>) → 200 + shape OK [régression 5.2-fix2]', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/tableau-de-bord/budget-vs-realise')
      .query({
        versionId,
        scenarioId,
        moisDebut: '2027-01',
        moisFin: '2027-03',
        crIds: crId1, // string scalaire — Transform doit le convertir en [crId1]
      })
      .set(bearer(session))
      .expect(200);
    expectShape(res.body);
  });

  it('crIds repeat (crIds=<a>&crIds=<b>&crIds=<c>) → 200 + shape OK [régression 5.2-fix1]', async () => {
    // SuperTest avec .query({ crIds: [a, b] }) sérialise en
    // ?crIds=a&crIds=b (format repeat). Le parser qs d'Express
    // produit alors un array → DTO accepte.
    const res = await request(app.getHttpServer())
      .get('/api/v1/tableau-de-bord/budget-vs-realise')
      .query({
        versionId,
        scenarioId,
        moisDebut: '2027-01',
        moisFin: '2027-03',
        crIds: [crId1, crId2],
      })
      .set(bearer(session))
      .expect(200);
    expectShape(res.body);
  });

  it('crIds brackets (crIds[]=<a>&crIds[]=<b>) → 200 OU 400 explicite (selon implémentation)', async () => {
    // Format brackets (qs extended). Si le ValidationPipe global
    // (`forbidNonWhitelisted: true`) rejette `crIds[]` comme champ
    // non whitelisted, le mandat autorise 400 — l'objectif du test
    // est d'éviter un 500 silencieux. Si supporté → 200 + shape OK.
    const url =
      `/api/v1/tableau-de-bord/budget-vs-realise` +
      `?versionId=${encodeURIComponent(versionId)}` +
      `&scenarioId=${encodeURIComponent(scenarioId)}` +
      `&moisDebut=2027-01&moisFin=2027-03` +
      `&crIds[]=${encodeURIComponent(crId1)}` +
      `&crIds[]=${encodeURIComponent(crId2)}`;
    const res = await request(app.getHttpServer())
      .get(url)
      .set(bearer(session));

    expect([200, 400]).toContain(res.status);
    if (res.status === 200) {
      expectShape(res.body);
    } else {
      // 400 doit être une erreur explicite (pas un crash 500).
      expect(res.body).toEqual(
        expect.objectContaining({
          statusCode: 400,
          message: expect.anything(),
        }),
      );
    }
  });

  it('sans crIds → 200 + shape OK (toutes les lignes du périmètre)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/tableau-de-bord/budget-vs-realise')
      .query({
        versionId,
        scenarioId,
        moisDebut: '2027-01',
        moisFin: '2027-03',
      })
      .set(bearer(session))
      .expect(200);
    expectShape(res.body);
  });
});
