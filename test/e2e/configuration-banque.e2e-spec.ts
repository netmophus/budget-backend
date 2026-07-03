/**
 * E2E — Configuration banque (Lot B1, HTTP réel + DB réelle).
 *
 * Couvre :
 *  - GET /configuration-banque/public SANS auth -> 200 (whitelist)
 *  - GET /configuration-banque sans BANQUE.GERER (LECTEUR) -> 403
 *  - GET /configuration-banque avec BANQUE.GERER (ADMIN) -> 200 + membres
 *  - PUT /configuration-banque (ADMIN) -> 200
 *  - CRUD membre Comité (ADMIN) -> 200
 *
 * La permission BANQUE.GERER est seedée + attribuée à ADMIN par la
 * migration 590 ; le seed BSIC NIGER fournit la ligne id=1.
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { bootstrapApp } from './helpers/app';
import { type AuthSession, bearer, login, PERSONAS } from './helpers/auth';

describe('E2E — Configuration banque (Lot B1)', () => {
  let app: INestApplication;
  let adminSession: AuthSession;
  let lecteurSession: AuthSession;

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
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /configuration-banque/public SANS auth -> 200 + whitelist stricte', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/configuration-banque/public')
      .expect(200);
    expect(res.body.nom).toBe('BSIC NIGER');
    expect(res.body.couleurPrimaire).toBe('#1B2A4E');
    // Aucun champ sensible exposé publiquement.
    expect(res.body).not.toHaveProperty('contexteMarche');
    expect(res.body).not.toHaveProperty('membres');
    expect(res.body).not.toHaveProperty('refReglementaireBceao');
  });

  it('GET /configuration-banque sans BANQUE.GERER (LECTEUR) -> 403', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/configuration-banque')
      .set(bearer(lecteurSession))
      .expect(403);
  });

  it('GET /configuration-banque avec BANQUE.GERER (ADMIN) -> 200 + membres', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/configuration-banque')
      .set(bearer(adminSession))
      .expect(200);
    expect(res.body.nom).toBe('BSIC NIGER');
    expect(res.body.sigle).toBe('BSIC');
    expect(Array.isArray(res.body.membres)).toBe(true);
    expect(res.body.membres.length).toBeGreaterThanOrEqual(5);
  });

  it('PUT /configuration-banque (ADMIN) -> 200 met à jour', async () => {
    const res = await request(app.getHttpServer())
      .put('/api/v1/configuration-banque')
      .set(bearer(adminSession))
      .send({
        telephone: '+227 20 00 00 00',
        refReglementaireBceao: 'REF-2027',
      })
      .expect(200);
    expect(res.body.telephone).toBe('+227 20 00 00 00');
    expect(res.body.refReglementaireBceao).toBe('REF-2027');
  });

  it('CRUD membre Comité (ADMIN) : ajout -> modif -> désactivation', async () => {
    const ajout = await request(app.getHttpServer())
      .post('/api/v1/configuration-banque/membres')
      .set(bearer(adminSession))
      .send({ nomPrenom: 'Test MEMBRE', titre: 'M.', fonction: 'MEMBRE' })
      .expect(201);
    const id = ajout.body.id as string;
    expect(ajout.body.estActif).toBe(true);

    await request(app.getHttpServer())
      .put(`/api/v1/configuration-banque/membres/${id}`)
      .set(bearer(adminSession))
      .send({ nomPrenom: 'Test MEMBRE MODIFIE' })
      .expect(200);

    const desac = await request(app.getHttpServer())
      .delete(`/api/v1/configuration-banque/membres/${id}`)
      .set(bearer(adminSession))
      .expect(200);
    expect(desac.body.estActif).toBe(false);
  });

  it('POST membre sans BANQUE.GERER (LECTEUR) -> 403', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/configuration-banque/membres')
      .set(bearer(lecteurSession))
      .send({ nomPrenom: 'X', fonction: 'MEMBRE' })
      .expect(403);
  });
});
