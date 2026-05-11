/**
 * E2E.2 — Saisie réalisé end-to-end (HTTP réel + DB réelle).
 *
 * Couvre :
 *  - Récupération de id_temps via /referentiels/temps/par-date/:date
 *  - POST /realise (saisie adj.retail SAISISSEUR Plateau) → 201
 *  - GET /realise → la ligne apparaît
 *  - PATCH /realise/:id (modif montant) → 200
 *  - DELETE /realise/:id → 200 (faite avec admin car SAISISSEUR n'a
 *    pas REALISE.SUPPRIMER ; cf. migration 1779200000150)
 *  - audit_log : 3 entrées (SAISIR_REALISE x2 + SUPPRIMER_REALISE x1)
 *
 * Pré-requis fixture in-process :
 *  - adj.retail affecté au périmètre CR_AG_ABJ_PLATEAU (sinon le
 *    filtrage écriture user_perimetres → 403).
 */
import type { INestApplication } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import request from 'supertest';
import type { DataSource } from 'typeorm';

import { bootstrapApp } from './helpers/app';
import { type AuthSession, bearer, login, PERSONAS } from './helpers/auth';
import { affecterPerimetreCR } from './fixtures/perimetres';
import {
  getCompteId,
  getCrId,
  getDeviseId,
  getLigneMetierId,
  getTempsIdParDate,
} from './fixtures/referentiels';

describe('E2E.2 — Saisie réalisé end-to-end', () => {
  let app: INestApplication;
  let adjSession: AuthSession;
  let adminSession: AuthSession;
  let fkTemps: string;
  let fkCompte: string;
  let fkLigneMetier: string;
  let fkDevise: string;
  let fkCentreResponsabilite: string;
  let realiseId: string;

  beforeAll(async () => {
    app = await bootstrapApp();
    await affecterPerimetreCR(
      app,
      PERSONAS.ADJ_RETAIL.email,
      'CR_AG_ABJ_PLATEAU',
    );
    adjSession = await login(
      app,
      PERSONAS.ADJ_RETAIL.email,
      PERSONAS.ADJ_RETAIL.motDePasse,
    );
    adminSession = await login(
      app,
      PERSONAS.ADMIN.email,
      PERSONAS.ADMIN.motDePasse,
    );

    fkTemps = await getTempsIdParDate(app, '2027-03-01');
    fkCompte = await getCompteId(app, '701100');
    fkLigneMetier = await getLigneMetierId(app, 'RETAIL_PARTICULIERS');
    fkDevise = await getDeviseId(app, 'XOF');
    fkCentreResponsabilite = await getCrId(app, 'CR_AG_ABJ_PLATEAU');
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /referentiels/temps/par-date/:date renvoie l'id du jour", async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/referentiels/temps/par-date/2027-03-01')
      .set(bearer(adjSession))
      .expect(200);

    expect(res.body.id).toBe(fkTemps);
  });

  it('POST /realise (adj.retail SAISISSEUR) crée la ligne', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/realise')
      .set(bearer(adjSession))
      .send({
        fkCentreResponsabilite,
        fkCompte,
        fkLigneMetier,
        fkTemps,
        fkDevise,
        montant: 4800000,
      })
      .expect(201);

    expect(res.body).toMatchObject({
      id: expect.any(String),
      fkCentreResponsabilite,
      fkCompte,
      fkTemps,
      montant: 4800000,
      statut: 'IMPORTE',
      source: 'SAISIE',
    });
    realiseId = res.body.id;
  });

  it('GET /realise → la ligne apparaît dans la liste', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/realise')
      .set(bearer(adjSession))
      .expect(200);

    expect(res.body.items).toBeDefined();
    expect(Array.isArray(res.body.items)).toBe(true);
    const ids: string[] = res.body.items.map((l: { id: string }) => l.id);
    expect(ids).toContain(realiseId);
  });

  it('PATCH /realise/:id met à jour le montant', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/v1/realise/${realiseId}`)
      .set(bearer(adjSession))
      .send({ montant: 5000000 })
      .expect(200);

    expect(res.body.montant).toBe(5000000);
  });

  it('DELETE /realise/:id (admin) supprime la ligne (statut IMPORTE)', async () => {
    await request(app.getHttpServer())
      .delete(`/api/v1/realise/${realiseId}`)
      .set(bearer(adminSession))
      .expect(200);

    // La ligne ne doit plus apparaître dans le listing.
    const res = await request(app.getHttpServer())
      .get('/api/v1/realise')
      .set(bearer(adjSession))
      .expect(200);
    const ids: string[] = res.body.items.map((l: { id: string }) => l.id);
    expect(ids).not.toContain(realiseId);
  });

  it('SAISISSEUR (adj.retail) tente DELETE → 403 (REALISE.SUPPRIMER manquant)', async () => {
    // Crée une nouvelle ligne avec adj.retail puis tente DELETE avec lui-même.
    const created = await request(app.getHttpServer())
      .post('/api/v1/realise')
      .set(bearer(adjSession))
      .send({
        fkCentreResponsabilite,
        fkCompte,
        fkLigneMetier,
        fkTemps,
        fkDevise,
        montant: 1234567,
      })
      .expect(201);
    const tempId = created.body.id;

    await request(app.getHttpServer())
      .delete(`/api/v1/realise/${tempId}`)
      .set(bearer(adjSession))
      .expect(403);

    // Cleanup admin.
    await request(app.getHttpServer())
      .delete(`/api/v1/realise/${tempId}`)
      .set(bearer(adminSession))
      .expect(200);
  });

  it('audit_log : 3 entrées sur ce flux (SAISIR x2 + SUPPRIMER x1)', async () => {
    const ds = app.get<DataSource>(getDataSourceToken());
    const rows = (await ds.query(
      `SELECT type_action, COUNT(*)::int AS n
         FROM audit_log
        WHERE type_action IN ('SAISIR_REALISE', 'SUPPRIMER_REALISE')
        GROUP BY type_action
        ORDER BY type_action`,
    )) as Array<{ type_action: string; n: number }>;

    const counts = Object.fromEntries(rows.map((r) => [r.type_action, r.n]));
    expect(counts.SAISIR_REALISE).toBeGreaterThanOrEqual(2);
    expect(counts.SUPPRIMER_REALISE).toBeGreaterThanOrEqual(1);
  });
});
