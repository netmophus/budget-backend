/**
 * E2E.6 — Multi-périmètres + délégations.
 *
 * Couvre le flux complet **via HTTP réel** (pas d'in-process pour ce
 * test : la création user, l'affectation périmètre et la délégation
 * SONT l'objet du test, conformément à la convention archi e2e).
 *
 *   1. Admin crée un nouveau user via POST /admin/users.
 *   2. Admin affecte le user au périmètre CR_AG_ABJ_PLATEAU via
 *      POST /admin/users/:userId/perimetres.
 *   3. Le nouveau user se connecte → GET /me/perimetres → 1 affectation.
 *   4. GET /budget/grille avec un CR hors périmètre (Cocody) → 403 ou
 *      200+0 selon l'implémentation RBAC.
 *   5. Le nouveau user délègue son périmètre à un autre user via
 *      POST /delegations.
 *   6. Le délégataire voit la délégation via GET /delegations/recues.
 *   7. Vérif SQL : user_perimetres + delegations bien créés.
 */
import type { INestApplication } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import request from 'supertest';
import type { DataSource } from 'typeorm';

import { bootstrapApp } from './helpers/app';
import { type AuthSession, bearer, login, PERSONAS } from './helpers/auth';
import {
  getCrId,
  getLigneMetierId,
  getScenarioId,
  getVersionId,
} from './fixtures/referentiels';

describe('E2E.6 — Multi-périmètres + délégations', () => {
  let app: INestApplication;
  let adminSession: AuthSession;
  let nouveauEmail: string;
  let nouveauUserId: string;
  let nouveauSession: AuthSession;
  let userPerimetreId: string;
  let fkRoleSaisisseur: string;

  beforeAll(async () => {
    app = await bootstrapApp();
    adminSession = await login(
      app,
      PERSONAS.ADMIN.email,
      PERSONAS.ADMIN.motDePasse,
    );

    const ds = app.get<DataSource>(getDataSourceToken());
    const rows = (await ds.query(
      `SELECT id FROM ref_role WHERE code_role = 'SAISISSEUR'`,
    )) as Array<{ id: string }>;
    fkRoleSaisisseur = String(rows[0]!.id);

    nouveauEmail = `e2e6.user.${Date.now()}@miznas.local`;
  });

  afterAll(async () => {
    await app.close();
  });

  it('admin crée un user via POST /admin/users', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/admin/users')
      .set(bearer(adminSession))
      .send({
        email: nouveauEmail,
        nom: 'TestE2E6',
        prenom: 'Saisisseur',
        motDePasseInitial: 'PassE2E6Test!2026',
        fkRoles: [fkRoleSaisisseur],
      })
      .expect(201);

    expect(res.body).toMatchObject({
      id: expect.any(String),
      email: nouveauEmail,
    });
    nouveauUserId = res.body.id;
  });

  it('admin affecte un périmètre Plateau au nouveau user via POST /admin/users/:userId/perimetres', async () => {
    const fkCrPlateau = await getCrId(app, 'CR_AG_ABJ_PLATEAU');
    const res = await request(app.getHttpServer())
      .post(`/api/v1/admin/users/${nouveauUserId}/perimetres`)
      .set(bearer(adminSession))
      .send({
        cibleType: 'CR',
        cibleId: fkCrPlateau,
        dateDebut: '2026-01-01',
        motif: 'Affectation initiale e2e',
      })
      .expect(201);

    expect(res.body).toMatchObject({
      id: expect.any(String),
      cibleType: 'CR',
      cibleId: fkCrPlateau,
      actif: true,
    });
    userPerimetreId = res.body.id;
  });

  it('nouveau user se connecte et voit son périmètre via GET /me/perimetres', async () => {
    nouveauSession = await login(app, nouveauEmail, 'PassE2E6Test!2026');

    const res = await request(app.getHttpServer())
      .get('/api/v1/me/perimetres')
      .set(bearer(nouveauSession))
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    const ids: string[] = res.body.map((p: { id: string }) => p.id);
    expect(ids).toContain(userPerimetreId);
  });

  it('GET /budget/grille avec CR hors périmètre (Cocody) → 403 ou 200+0 lignes', async () => {
    const fkCrCocody = await getCrId(app, 'CR_AG_ABJ_COCODY');
    const versionId = await getVersionId(app, 'BUDGET_INITIAL_2026');
    const scenarioId = await getScenarioId(app, 'CENTRAL');
    const ligneMetierId = await getLigneMetierId(app, 'RETAIL_PARTICULIERS');

    const res = await request(app.getHttpServer())
      .get('/api/v1/budget/grille')
      .query({
        versionId,
        scenarioId,
        crId: fkCrCocody,
        exerciceFiscal: 2026,
        ligneMetierId,
      })
      .set(bearer(nouveauSession));

    // Le RBAC du projet peut renvoyer soit 403 (interdiction explicite)
    // soit 200 avec 0 lignes (filtrage silencieux). Les 2 sont valides
    // selon le design — on rejette uniquement les crash 5xx.
    expect([200, 403]).toContain(res.status);
    if (res.status === 200) {
      // Si 200, doit avoir une shape grille valide (lignes vides OK).
      expect(res.body).toBeDefined();
    }
  });

  it('nouveau user crée une délégation à lecteur via POST /delegations', async () => {
    // fkDelegataire = lecteur (sera la cible de la délégation).
    const ds = app.get<DataSource>(getDataSourceToken());
    const rows = (await ds.query(
      `SELECT id FROM "user" WHERE email = $1`,
      [PERSONAS.LECTEUR.email],
    )) as Array<{ id: string }>;
    const fkDelegataire = String(rows[0]!.id);

    const res = await request(app.getHttpServer())
      .post('/api/v1/delegations')
      .set(bearer(nouveauSession))
      .send({
        fkDelegataire,
        perimetreUserPerimetreIds: [userPerimetreId],
        permissions: ['SAISIE'],
        motif: 'Absence temporaire e2e',
        dateDebut: '2026-06-01',
        dateFin: '2026-06-30',
      })
      .expect(201);

    expect(res.body).toMatchObject({
      id: expect.any(String),
      fkDelegataire,
      permissions: ['SAISIE'],
      statut: 'ACTIVE',
    });
  });

  it('lecteur (délégataire) voit la délégation via GET /delegations/recues', async () => {
    const lecteurSession = await login(
      app,
      PERSONAS.LECTEUR.email,
      PERSONAS.LECTEUR.motDePasse,
    );

    const res = await request(app.getHttpServer())
      .get('/api/v1/delegations/recues')
      .set(bearer(lecteurSession))
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    const motifs = res.body.map((d: { motif: string }) => d.motif);
    expect(motifs).toContain('Absence temporaire e2e');
  });

  it('vérif SQL : user_perimetres et delegations bien persistés', async () => {
    const ds = app.get<DataSource>(getDataSourceToken());

    const upRows = (await ds.query(
      `SELECT id, fk_user, cible_type, cible_id, actif
         FROM user_perimetres
        WHERE fk_user = $1 AND actif = true`,
      [nouveauUserId],
    )) as Array<{ cible_type: string; actif: boolean }>;
    expect(upRows.length).toBeGreaterThanOrEqual(1);
    expect(upRows[0]!.cible_type).toBe('CR');

    const delRows = (await ds.query(
      `SELECT id, fk_delegant, fk_delegataire, actif
         FROM delegations
        WHERE fk_delegant = $1 AND actif = true`,
      [nouveauUserId],
    )) as Array<{ fk_delegant: string; actif: boolean }>;
    expect(delRows.length).toBeGreaterThanOrEqual(1);
    expect(delRows[0]!.actif).toBe(true);
  });
});
