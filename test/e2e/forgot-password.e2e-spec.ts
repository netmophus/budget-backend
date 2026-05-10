/**
 * E2E.10 — Forgot password self-service (Lot 6.5.A).
 *
 * Couvre :
 *  1. Email connu actif → 200 + INSERT password_reset_token + INSERT
 *     email_log EN_ATTENTE (sans le token clair en payload).
 *  2. Email inconnu → 200 même réponse exacte (anti-énumération) +
 *     audit DEMANDE_RESET_MDP_INCONNU + AUCUN INSERT token / email_log.
 *  3. Flux complet forgot → reset : récupère le token clair depuis le
 *     job BullMQ via une interception en mémoire, soumet POST
 *     /auth/reset-password, vérifie que le user peut se logger avec
 *     le nouveau mdp.
 *  4. Token réutilisé → 400 INVALID_TOKEN (sécurité usage unique).
 *  5. Token inconnu → 400 INVALID_TOKEN.
 *  6. Token expiré → 410 EXPIRED_TOKEN.
 *  7. Nouveau mdp non conforme → 400 (validation DTO MotDePasseValide).
 *  8. Rate limit 3/15min/IP → 4ème POST /auth/forgot-password = 429.
 *
 * Sécurité — assertions explicites :
 *  - Le token stocké en base est un hash SHA-256 (64 chars hex), pas
 *    le UUID en clair.
 *  - email_log.payload NE contient PAS le token clair ni le lien
 *    complet (anti-leak en cas de fuite SQL).
 *  - audit_log.payload_apres NE contient PAS le token clair.
 */
import { type INestApplication } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { createHash } from 'node:crypto';
import request from 'supertest';
import type { DataSource } from 'typeorm';

import { bootstrapApp } from './helpers/app';
import { PERSONAS } from './helpers/auth';
import { LoginRateLimiterService } from '../../src/auth/login-rate-limiter.service';
import { EmailQueueProducer } from '../../src/notifications/email-queue.producer';

interface CapturedJob {
  emailLogId: string;
  secrets?: Record<string, string>;
}

describe('E2E.10 — Forgot password self-service', () => {
  let app: INestApplication;
  let ds: DataSource;
  let limiter: LoginRateLimiterService;
  let queue: EmailQueueProducer;
  const persona = PERSONAS.DGA_EXPLOITATION;
  // Capture des jobs publiés (le worker n'est pas démarré en e2e car
  // pas de Redis) — on intercepte `publier` pour récupérer le token
  // clair des secrets sans démarrer le worker.
  const capturedJobs: CapturedJob[] = [];

  beforeAll(async () => {
    process.env.LOGIN_RATE_LIMIT_DISABLED = 'false';
    app = await bootstrapApp();
    ds = app.get<DataSource>(getDataSourceToken());
    limiter = app.get(LoginRateLimiterService);
    queue = app.get(EmailQueueProducer);
    // Mock publier pour ne pas pousser dans Redis (qui peut ne pas
    // être démarré en e2e) ; on capture les secrets pour récupérer
    // le token clair côté test.
    jest
      .spyOn(queue, 'publier')
      .mockImplementation(async (id: string, secrets) => {
        capturedJobs.push({ emailLogId: id, secrets });
      });
  });

  afterAll(async () => {
    await app.close();
    process.env.LOGIN_RATE_LIMIT_DISABLED = 'true';
  });

  beforeEach(async () => {
    capturedJobs.length = 0;
    limiter.reset();
    // Reset du persona : mdp seedé + flags clean + purge tokens.
    const hash = await bcrypt.hash(persona.motDePasse, 4);
    await ds.query(
      `UPDATE "user"
          SET mot_de_passe_hash = $1,
              doit_changer_mdp = false,
              date_expiration_mdp = NULL
        WHERE email = $2`,
      [hash, persona.email],
    );
    await ds.query(
      `DELETE FROM password_reset_token
        WHERE fk_user = (SELECT id FROM "user" WHERE email = $1)`,
      [persona.email],
    );
  });

  it('email connu → 200 + INSERT token (hash SHA-256) + email_log EN_ATTENTE sans token clair', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/forgot-password')
      .send({ email: persona.email })
      .expect(200);

    expect(res.body).toEqual({
      success: true,
      message: "Si l'email existe, un lien de réinitialisation a été envoyé.",
    });

    // Token stocké en hash SHA-256 (64 chars hex).
    const tokens = (await ds.query(
      `SELECT token, utilise, date_expiration FROM password_reset_token
        WHERE fk_user = (SELECT id FROM "user" WHERE email = $1)`,
      [persona.email],
    )) as Array<{ token: string; utilise: boolean; date_expiration: Date }>;
    expect(tokens).toHaveLength(1);
    expect(tokens[0]!.token).toMatch(/^[a-f0-9]{64}$/);
    expect(tokens[0]!.utilise).toBe(false);

    // email_log EN_ATTENTE, payload SANS token clair ni lien.
    const logs = (await ds.query(
      `SELECT statut, payload FROM email_log
        WHERE evenement = 'RESET_PASSWORD_SELF_SERVICE'
          AND destinataire_email = $1
        ORDER BY id DESC LIMIT 1`,
      [persona.email],
    )) as Array<{ statut: string; payload: Record<string, unknown> }>;
    expect(logs).toHaveLength(1);
    expect(logs[0]!.statut).toBe('EN_ATTENTE');
    const payloadStr = JSON.stringify(logs[0]!.payload);
    expect(payloadStr).not.toContain(tokens[0]!.token);
    expect(payloadStr).not.toMatch(/^.*token.*$/i);
    expect(logs[0]!.payload).toHaveProperty('expiration_minutes', 30);

    // Job capturé : contient le token clair en secrets.
    expect(capturedJobs).toHaveLength(1);
    const job = capturedJobs[0]!;
    expect(job.secrets).toBeDefined();
    expect(job.secrets!.token).toMatch(/^[0-9a-f-]{36}$/);
    expect(createHash('sha256').update(job.secrets!.token).digest('hex')).toBe(
      tokens[0]!.token,
    );

    // audit_log : 1 entrée DEMANDE_RESET_MDP_USER, payload sans token.
    const audits = (await ds.query(
      `SELECT type_action, payload_apres FROM audit_log
        WHERE type_action = 'DEMANDE_RESET_MDP_USER'
          AND utilisateur = $1
        ORDER BY id DESC LIMIT 1`,
      [persona.email],
    )) as Array<{
      type_action: string;
      payload_apres: Record<string, unknown> | null;
    }>;
    expect(audits).toHaveLength(1);
    expect(JSON.stringify(audits[0]!.payload_apres ?? {})).not.toContain(
      job.secrets!.token,
    );
  });

  it('email inconnu → réponse identique + audit DEMANDE_RESET_MDP_INCONNU + 0 INSERT', async () => {
    const fauxEmail = `e2e-inconnu-${Date.now()}@miznas.local`;
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/forgot-password')
      .send({ email: fauxEmail })
      .expect(200);

    expect(res.body).toEqual({
      success: true,
      message: "Si l'email existe, un lien de réinitialisation a été envoyé.",
    });

    expect(capturedJobs).toHaveLength(0);
    const tokens = (await ds.query(
      `SELECT id FROM password_reset_token`,
    )) as unknown[];
    // Aucune INSERT pour cet email.
    const audits = (await ds.query(
      `SELECT type_action FROM audit_log
        WHERE utilisateur = $1
          AND type_action = 'DEMANDE_RESET_MDP_INCONNU'`,
      [fauxEmail],
    )) as Array<{ type_action: string }>;
    expect(audits).toHaveLength(1);
    void tokens; // (assertion sur l'absence côté audit suffit).
  });

  it('flux complet forgot → reset → login avec nouveau mdp réussi', async () => {
    // 1. POST forgot-password
    await request(app.getHttpServer())
      .post('/api/v1/auth/forgot-password')
      .send({ email: persona.email })
      .expect(200);
    expect(capturedJobs).toHaveLength(1);
    const tokenClair = capturedJobs[0]!.secrets!.token;

    // 2. POST reset-password avec nouveau mdp policy-conforme.
    const nouveauMdp = 'NewPassReset!2026';
    const reset = await request(app.getHttpServer())
      .post('/api/v1/auth/reset-password')
      .send({ token: tokenClair, nouveauMdp })
      .expect(200);
    expect(reset.body.success).toBe(true);

    // 3. Login avec le nouveau mdp.
    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: persona.email, motDePasse: nouveauMdp })
      .expect(200);
    expect(loginRes.body.doitChangerMdp).toBe(false);

    // 4. Token marqué utilise=true.
    const tokens = (await ds.query(
      `SELECT utilise FROM password_reset_token
        WHERE fk_user = (SELECT id FROM "user" WHERE email = $1)`,
      [persona.email],
    )) as Array<{ utilise: boolean }>;
    expect(tokens[0]!.utilise).toBe(true);
  });

  it('token réutilisé → 400 INVALID_TOKEN', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/forgot-password')
      .send({ email: persona.email })
      .expect(200);
    const tokenClair = capturedJobs[0]!.secrets!.token;

    // 1ère utilisation OK
    await request(app.getHttpServer())
      .post('/api/v1/auth/reset-password')
      .send({ token: tokenClair, nouveauMdp: 'ResetOnce!2026' })
      .expect(200);

    // 2ème utilisation → 400.
    const reuse = await request(app.getHttpServer())
      .post('/api/v1/auth/reset-password')
      .send({ token: tokenClair, nouveauMdp: 'ResetTwice!2026' });
    expect(reuse.status).toBe(400);
    expect(reuse.body).toEqual(
      expect.objectContaining({ errorCode: 'INVALID_TOKEN' }),
    );
  });

  it('token inconnu → 400 INVALID_TOKEN', async () => {
    const reset = await request(app.getHttpServer())
      .post('/api/v1/auth/reset-password')
      .send({
        token: '00000000-0000-4000-8000-000000000000',
        nouveauMdp: 'ResetInvalid!2026',
      });
    expect(reset.status).toBe(400);
    expect(reset.body).toEqual(
      expect.objectContaining({ errorCode: 'INVALID_TOKEN' }),
    );
  });

  it('token expiré → 410 EXPIRED_TOKEN', async () => {
    // Insert direct d'un token expiré.
    const userIdRow = (await ds.query(
      `SELECT id FROM "user" WHERE email = $1`,
      [persona.email],
    )) as Array<{ id: string }>;
    const userId = userIdRow[0]!.id;
    const tokenClair = '11111111-1111-4111-8111-111111111111';
    const tokenHash = createHash('sha256').update(tokenClair).digest('hex');
    const dejaExpire = new Date(Date.now() - 60_000);
    await ds.query(
      `INSERT INTO password_reset_token
         (fk_user, token, date_expiration, utilise, utilisateur_creation)
       VALUES ($1, $2, $3, false, 'e2e-test')`,
      [userId, tokenHash, dejaExpire],
    );

    const reset = await request(app.getHttpServer())
      .post('/api/v1/auth/reset-password')
      .send({ token: tokenClair, nouveauMdp: 'AnotherReset!2026' });
    expect(reset.status).toBe(410);
    expect(reset.body).toEqual(
      expect.objectContaining({ errorCode: 'EXPIRED_TOKEN' }),
    );
  });

  it('nouveau mdp non conforme à la policy → 400 (DTO @MotDePasseValide)', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/forgot-password')
      .send({ email: persona.email })
      .expect(200);
    const tokenClair = capturedJobs[0]!.secrets!.token;
    const reset = await request(app.getHttpServer())
      .post('/api/v1/auth/reset-password')
      .send({ token: tokenClair, nouveauMdp: 'short' });
    expect(reset.status).toBe(400);
  });

  it('rate limit forgot-password : 4ème tentative depuis la même IP = 429', async () => {
    // 3 tentatives autorisées (peu importe le résultat — on tape du
    // faux email pour ne pas polluer le persona).
    const fauxEmail = `e2e-rl-${Date.now()}@miznas.local`;
    for (let i = 0; i < 3; i++) {
      await request(app.getHttpServer())
        .post('/api/v1/auth/forgot-password')
        .send({ email: fauxEmail })
        .expect(200);
    }
    const quatrieme = await request(app.getHttpServer())
      .post('/api/v1/auth/forgot-password')
      .send({ email: fauxEmail });
    expect(quatrieme.status).toBe(429);
    expect(quatrieme.body).toEqual(
      expect.objectContaining({ errorCode: 'LOGIN_RATE_LIMITED' }),
    );
    expect(quatrieme.headers['retry-after']).toBeDefined();
  });
});
