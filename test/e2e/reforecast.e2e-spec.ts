/**
 * E2E.5 — Reforecast trimestriel avec écrasement OBSOLETE.
 *
 * Pré-requis fixture in-process :
 *   - 1 version dédiée au statut `gele` (publié)
 *   - 12 lignes fait_budget pour cette version (mois 01..12 de l'année
 *     consolidée, sur (Plateau, 701100, RETAIL_PARTICULIERS, CENTRAL))
 *   - 3 lignes fait_realise statut VALIDE pour T1 (mois 01, 02, 03)
 *
 * Le test exerce :
 *   - POST /reforecast/lancer → 1er reforecast (ACTIVE)
 *   - POST /reforecast/lancer mêmes params → 2e reforecast (ACTIVE) +
 *     1er bascule en OBSOLETE
 *   - GET /reforecast/:id sur les 2 → vérification statut_publication
 *   - audit_log : LANCER_REFORECAST x2 + MARQUER_REFORECAST_OBSOLETE x1
 */
import type { INestApplication } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import request from 'supertest';
import type { DataSource } from 'typeorm';

import { bootstrapApp } from './helpers/app';
import { type AuthSession, bearer, login, PERSONAS } from './helpers/auth';
import { insertFaitBudget, insertFaitRealise, setVersionStatut } from './fixtures/faits';
import {
  getCompteId,
  getCrId,
  getDeviseId,
  getLigneMetierId,
  getScenarioId,
  getTempsIdParDate,
} from './fixtures/referentiels';

const ANNEE_REF = 2026;

describe('E2E.5 — Reforecast avec écrasement OBSOLETE', () => {
  let app: INestApplication;
  let session: AuthSession;
  let fkVersionSource: string;
  let fkScenario: string;

  beforeAll(async () => {
    app = await bootstrapApp();
    session = await login(
      app,
      PERSONAS.ADMIN.email,
      PERSONAS.ADMIN.motDePasse,
    );

    const ds = app.get<DataSource>(getDataSourceToken());
    const adminRow = (await ds.query(
      `SELECT id FROM "user" WHERE email = $1`,
      [PERSONAS.ADMIN.email],
    )) as Array<{ id: string }>;
    const fkAdmin = String(adminRow[0]!.id);

    fkScenario = await getScenarioId(app, 'CENTRAL');
    const fkCompte = await getCompteId(app, '701100');
    const fkLigneMetier = await getLigneMetierId(app, 'RETAIL_PARTICULIERS');
    const fkDevise = await getDeviseId(app, 'XOF');
    const fkCentreResponsabilite = await getCrId(app, 'CR_AG_ABJ_PLATEAU');

    // 1. Créer une version dédiée au reforecast et la passer en gele.
    const codeVersion = `BUDGET_E2E5_${Date.now()}`;
    const v = await request(app.getHttpServer())
      .post('/api/v1/referentiels/versions')
      .set(bearer(session))
      .send({
        codeVersion,
        libelle: 'Budget source E2E reforecast',
        typeVersion: 'budget_initial',
        exerciceFiscal: ANNEE_REF,
      })
      .expect(201);
    fkVersionSource = v.body.id;
    await setVersionStatut(app, fkVersionSource, 'gele');

    // 2. Insérer 12 lignes fait_budget (1 par mois) sur la combinaison.
    for (let mois = 1; mois <= 12; mois++) {
      const date = `${ANNEE_REF}-${String(mois).padStart(2, '0')}-01`;
      const fkTemps = await getTempsIdParDate(app, date);
      await insertFaitBudget(app, {
        fkVersion: fkVersionSource,
        fkScenario,
        fkCentreResponsabilite,
        fkCompte,
        fkLigneMetier,
        fkTemps,
        fkDevise,
        montant: 1000000 + mois * 10000,
      });
    }

    // 3. Insérer 3 lignes fait_realise VALIDE pour T1 (mois 01, 02, 03).
    for (let mois = 1; mois <= 3; mois++) {
      const date = `${ANNEE_REF}-${String(mois).padStart(2, '0')}-01`;
      const fkTemps = await getTempsIdParDate(app, date);
      await insertFaitRealise(app, {
        fkCentreResponsabilite,
        fkCompte,
        fkLigneMetier,
        fkTemps,
        fkDevise,
        montant: 900000 + mois * 5000,
        fkValidePar: fkAdmin,
      });
    }
  });

  afterAll(async () => {
    await app.close();
  });

  it('1er POST /reforecast/lancer crée un reforecast ACTIVE', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/reforecast/lancer')
      .set(bearer(session))
      .send({
        fkVersionSource,
        fkScenarioSource: fkScenario,
        trimestreConsolide: 1,
        anneeConsolide: ANNEE_REF,
        methodeExtrapolation: 'MOYENNE_TRIMESTRE',
        libelleNouveauVersion: `Reforecast T1 ${ANNEE_REF} #1`,
      })
      .expect(201);

    expect(res.body).toMatchObject({
      id: expect.any(String),
      statutPublication: 'ACTIVE',
    });
  });

  it('2e POST /reforecast/lancer mêmes params : nouveau ACTIVE + ancien OBSOLETE', async () => {
    const res2 = await request(app.getHttpServer())
      .post('/api/v1/reforecast/lancer')
      .set(bearer(session))
      .send({
        fkVersionSource,
        fkScenarioSource: fkScenario,
        trimestreConsolide: 1,
        anneeConsolide: ANNEE_REF,
        methodeExtrapolation: 'MOYENNE_TRIMESTRE',
        libelleNouveauVersion: `Reforecast T1 ${ANNEE_REF} #2`,
      })
      .expect(201);

    expect(res2.body.statutPublication).toBe('ACTIVE');

    // Lister tous les reforecasts (ACTIVE + OBSOLETE) sur cette source/T1.
    const ds = app.get<DataSource>(getDataSourceToken());
    const rows = (await ds.query(
      `SELECT id, statut_publication, fk_version_remplacante, date_obsolescence
         FROM dim_version
        WHERE fk_version_source = $1
          AND trimestre_consolide = 1
          AND annee_consolide = $2
        ORDER BY date_creation`,
      [fkVersionSource, ANNEE_REF],
    )) as Array<{
      id: string;
      statut_publication: string;
      fk_version_remplacante: string | null;
      date_obsolescence: Date | null;
    }>;

    expect(rows.length).toBeGreaterThanOrEqual(2);
    const ancien = rows[0]!;
    const nouveau = rows[rows.length - 1]!;
    expect(ancien.statut_publication).toBe('OBSOLETE');
    expect(ancien.fk_version_remplacante).not.toBeNull();
    expect(ancien.date_obsolescence).not.toBeNull();
    expect(nouveau.statut_publication).toBe('ACTIVE');
  });

  it('audit_log : LANCER_REFORECAST x2 + MARQUER_REFORECAST_OBSOLETE x1', async () => {
    const ds = app.get<DataSource>(getDataSourceToken());
    const rows = (await ds.query(
      `SELECT type_action, COUNT(*)::int AS n
         FROM audit_log
        WHERE type_action IN ('LANCER_REFORECAST', 'MARQUER_REFORECAST_OBSOLETE')
        GROUP BY type_action`,
    )) as Array<{ type_action: string; n: number }>;
    const counts = Object.fromEntries(rows.map((r) => [r.type_action, r.n]));
    expect(counts.LANCER_REFORECAST).toBeGreaterThanOrEqual(2);
    expect(counts.MARQUER_REFORECAST_OBSOLETE).toBeGreaterThanOrEqual(1);
  });
});
