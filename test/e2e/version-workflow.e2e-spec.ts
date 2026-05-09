/**
 * E2E.4 — Workflow validation version budget (ouvert → soumis →
 * valide → gele).
 *
 * NB : le mandat utilise le vocabulaire UI (BROUILLON / SOUMIS /
 * VALIDE / PUBLIE) ; le code stocke en SQL bas niveau (ouvert /
 * soumis / valide / gele). On vérifie le statut SQL dans le test.
 *
 * Pré-requis fixture in-process : 1 ligne fait_budget pour la
 * version (sinon /soumettre → 422 "Version vide").
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { bootstrapApp } from './helpers/app';
import { type AuthSession, bearer, login, PERSONAS } from './helpers/auth';
import { insertFaitBudget } from './fixtures/faits';
import {
  getCompteId,
  getCrId,
  getDeviseId,
  getLigneMetierId,
  getScenarioId,
  getTempsIdParDate,
} from './fixtures/referentiels';

describe('E2E.4 — Workflow validation version', () => {
  let app: INestApplication;
  let session: AuthSession;

  beforeAll(async () => {
    app = await bootstrapApp();
    session = await login(
      app,
      PERSONAS.ADMIN.email,
      PERSONAS.ADMIN.motDePasse,
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('cas nominal : ouvert → soumis → valide → gele', async () => {
    // 1. Créer la version (statut=ouvert).
    const codeVersion = `BUDGET_E2E4_${Date.now()}`;
    const created = await request(app.getHttpServer())
      .post('/api/v1/referentiels/versions')
      .set(bearer(session))
      .send({
        codeVersion,
        libelle: 'Budget E2E 4 — workflow',
        typeVersion: 'budget_initial',
        exerciceFiscal: 2027,
        commentaire: 'Création par e2e workflow',
      })
      .expect(201);

    expect(created.body).toMatchObject({
      id: expect.any(String),
      codeVersion,
      statut: 'ouvert',
    });
    const versionId: string = created.body.id;

    // 2. Pré-requis : insérer 1 ligne fait_budget (sinon /soumettre → 422).
    const fkScenario = await getScenarioId(app, 'CENTRAL');
    const fkCompte = await getCompteId(app, '701100');
    const fkLigneMetier = await getLigneMetierId(app, 'RETAIL_PARTICULIERS');
    const fkDevise = await getDeviseId(app, 'XOF');
    const fkCentreResponsabilite = await getCrId(app, 'CR_AG_ABJ_PLATEAU');
    const fkTemps = await getTempsIdParDate(app, '2027-01-01');
    await insertFaitBudget(app, {
      fkVersion: versionId,
      fkScenario,
      fkCentreResponsabilite,
      fkCompte,
      fkLigneMetier,
      fkTemps,
      fkDevise,
      montant: 5000000,
    });

    // 3. Soumettre.
    const soumis = await request(app.getHttpServer())
      .post(`/api/v1/referentiels/versions/${versionId}/soumettre`)
      .set(bearer(session))
      .send({ commentaire: 'Soumission e2e' })
      .expect(200);
    expect(soumis.body.statut).toBe('soumis');

    // 4. Valider.
    const valide = await request(app.getHttpServer())
      .post(`/api/v1/referentiels/versions/${versionId}/valider`)
      .set(bearer(session))
      .send({ commentaire: 'Validation e2e' })
      .expect(200);
    expect(valide.body.statut).toBe('valide');

    // 5. Publier (gele).
    const gele = await request(app.getHttpServer())
      .post(`/api/v1/referentiels/versions/${versionId}/publier`)
      .set(bearer(session))
      .send({ commentaire: 'Publication e2e' })
      .expect(200);
    expect(gele.body.statut).toBe('gele');
  });

  it('cas négatif : POST /publier sur une version ouvert → 409 (statut différent de valide)', async () => {
    const codeVersion = `BUDGET_E2E4_NEG_${Date.now()}`;
    const created = await request(app.getHttpServer())
      .post('/api/v1/referentiels/versions')
      .set(bearer(session))
      .send({
        codeVersion,
        libelle: 'Budget E2E 4 — neg',
        typeVersion: 'budget_initial',
        exerciceFiscal: 2027,
      })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post(`/api/v1/referentiels/versions/${created.body.id}/publier`)
      .set(bearer(session))
      .send({});

    expect([400, 409]).toContain(res.status);
    expect(res.body).toEqual(
      expect.objectContaining({ message: expect.anything() }),
    );
  });
});
