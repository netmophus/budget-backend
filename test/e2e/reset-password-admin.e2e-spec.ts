/**
 * E2E.10 — Reset password admin async + email (Lot 6.4.C).
 *
 * Couvre le flux complet HTTP réel + Redis réel + DB réelle :
 *  1. Admin POST /admin/users/:id/reset-password
 *  2. Réponse API : { success: true, message } SANS motDePasseTemporaire
 *     (breaking change Lot 6.4.C).
 *  3. DB user : nouveau mot_de_passe_hash + doit_changer_mdp=true +
 *     date_expiration_mdp posée à ~7 jours.
 *  4. email_log statut EN_ATTENTE puis ENVOYE après le worker
 *     (queue BullMQ + Redis testcontainer + nodemailer mocké).
 *  5. SÉCURITÉ : email_log.payload NE contient PAS le mdp en clair
 *     (les secrets transitent uniquement par le job BullMQ).
 *  6. Le mdp envoyé par email permet bien de se reconnecter +
 *     déclenche le flag doitChangerMdp=true.
 *
 * `nodemailer` est mocké au niveau du module (jest.mock hoisted).
 * EMAIL_DRY_RUN est forcé à 'false' au beforeAll, restauré au afterAll.
 */
import { type INestApplication } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import request from 'supertest';
import type { DataSource } from 'typeorm';

import { bootstrapApp } from './helpers/app';
import { bearer, login, PERSONAS } from './helpers/auth';
import { EmailLog } from '../../src/notifications/entities/email-log.entity';

// ─── Mock nodemailer global pour ce file ─────────────────────────────
const sendMailMock = jest.fn();
jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({
    sendMail: (...args: unknown[]) => sendMailMock(...args),
  })),
}));

async function waitForStatut(
  ds: DataSource,
  emailLogId: string,
  attendus: ReadonlyArray<'ENVOYE' | 'ECHEC'>,
  timeoutMs = 15_000,
): Promise<EmailLog> {
  const repo = ds.getRepository(EmailLog);
  const start = Date.now();

  while (true) {
    const row = await repo.findOne({ where: { id: emailLogId } });
    if (row && (attendus as readonly string[]).includes(row.statut)) return row;
    if (Date.now() - start >= timeoutMs) {
      throw new Error(
        `email_log ${emailLogId} non terminé après ${String(timeoutMs)}ms (statut=${row?.statut ?? 'null'})`,
      );
    }
    await new Promise((r) => setTimeout(r, 150));
  }
}

describe('E2E.10 — Reset password admin async + email', () => {
  let app: INestApplication;
  let ds: DataSource;
  let cibleEmail: string;
  let cibleId: string;

  beforeAll(async () => {
    process.env.EMAIL_DRY_RUN = 'false';
    app = await bootstrapApp();
    ds = app.get<DataSource>(getDataSourceToken());

    // Créer un user dédié au reset (pour ne pas polluer les autres
    // personas seedés). Email random pour éviter conflits entre runs.
    cibleEmail = `e2e-reset-${Date.now()}@miznas.local`;
    const adminSession = await login(
      app,
      PERSONAS.ADMIN.email,
      PERSONAS.ADMIN.motDePasse,
    );
    // On reuse la fixture du palier 6.2.A : POST /admin/users.
    const lecteurRoleRow = (await ds.query(
      `SELECT id FROM ref_role WHERE code_role = 'LECTEUR' LIMIT 1`,
    )) as Array<{ id: string }>;
    const fkRoleLecteur = String(lecteurRoleRow[0]!.id);
    const created = await request(app.getHttpServer())
      .post('/api/v1/admin/users')
      .set(bearer(adminSession))
      .send({
        email: cibleEmail,
        nom: 'ResetTest',
        prenom: 'E2E',
        motDePasseInitial: 'InitialValide99@reset',
        fkRoles: [fkRoleLecteur],
      })
      .expect(201);
    cibleId = created.body.id as string;
  });

  afterAll(async () => {
    await app.close();
    process.env.EMAIL_DRY_RUN = 'true';
  });

  beforeEach(() => {
    sendMailMock.mockReset();
    sendMailMock.mockResolvedValue({ messageId: 'mock-reset' });
  });

  it('POST /admin/users/:id/reset-password → réponse SANS mdp + email envoyé + user reset bien en DB', async () => {
    const adminSession = await login(
      app,
      PERSONAS.ADMIN.email,
      PERSONAS.ADMIN.motDePasse,
    );

    // 1. Reset password.
    const res = await request(app.getHttpServer())
      .post(`/api/v1/admin/users/${cibleId}/reset-password`)
      .set(bearer(adminSession))
      .expect(200);

    expect(res.body).toEqual({
      success: true,
      message: expect.stringContaining(cibleEmail),
    });
    expect(res.body.motDePasseTemporaire).toBeUndefined();

    // 2. DB : doit_changer_mdp=true + date_expiration_mdp ~7 jours.
    const userRows = (await ds.query(
      `SELECT mot_de_passe_hash, doit_changer_mdp, date_expiration_mdp
         FROM "user" WHERE email = $1`,
      [cibleEmail],
    )) as Array<{
      mot_de_passe_hash: string;
      doit_changer_mdp: boolean;
      date_expiration_mdp: Date;
    }>;
    expect(userRows[0]!.doit_changer_mdp).toBe(true);
    expect(userRows[0]!.date_expiration_mdp).not.toBeNull();
    const diffMs =
      new Date(userRows[0]!.date_expiration_mdp).getTime() - Date.now();
    expect(diffMs).toBeGreaterThan(6 * 86_400_000);
    expect(diffMs).toBeLessThan(8 * 86_400_000);

    // 3. email_log : 1 entrée RESET_PASSWORD_ADMIN, payload SANS mdp.
    const logs = (await ds.query(
      `SELECT id, statut, payload FROM email_log
        WHERE evenement = 'RESET_PASSWORD_ADMIN'
          AND destinataire_email = $1
        ORDER BY date_creation DESC
        LIMIT 1`,
      [cibleEmail],
    )) as Array<{
      id: string;
      statut: string;
      payload: Record<string, unknown>;
    }>;
    expect(logs.length).toBeGreaterThanOrEqual(1);
    const log = logs[0]!;

    // 4. Polling jusqu'à ENVOYE (le worker doit consommer le job).
    const finalLog = await waitForStatut(ds, String(log.id), ['ENVOYE']);
    expect(finalLog.statut).toBe('ENVOYE');

    // 5. SMTP a bien été appelé avec le HTML qui contient le mdp.
    expect(sendMailMock).toHaveBeenCalled();
    const mailArg = sendMailMock.mock.calls[0]?.[0] as
      | { html: string; to: string }
      | undefined;
    expect(mailArg).toBeDefined();
    expect(mailArg!.to).toBe(cibleEmail);
    // Le mdp temporaire respecte la policy (≥12 chars, contient au
    // moins 1 maj/min/chiffre/spécial). On vérifie la présence d'un
    // motif compatible dans le HTML rendu (le mdp est encadré dans
    // un <code>{{mdpTemporaire}}</code>).
    const mdpMatch = /<code[^>]*>([^<]+)<\/code>/.exec(mailArg!.html);
    expect(mdpMatch).not.toBeNull();
    const mdpEnvoye = mdpMatch![1]!;
    expect(mdpEnvoye.length).toBeGreaterThanOrEqual(12);
    expect(mdpEnvoye).toMatch(/[A-Z]/);
    expect(mdpEnvoye).toMatch(/[a-z]/);
    expect(mdpEnvoye).toMatch(/[0-9]/);
    expect(mdpEnvoye).toMatch(/[^A-Za-z0-9]/);

    // 6. SÉCURITÉ : le mdp en clair n'est PAS dans email_log.payload.
    expect(JSON.stringify(finalLog.payload)).not.toContain(mdpEnvoye);
    // Et pas non plus dans audit_log.
    const audits = (await ds.query(
      `SELECT payload_apres, commentaire FROM audit_log
        WHERE type_action = 'RESET_PASSWORD_USER'
          AND id_cible = $1
        ORDER BY id DESC LIMIT 1`,
      [cibleId],
    )) as Array<{ payload_apres: unknown; commentaire: string }>;
    expect(audits.length).toBeGreaterThanOrEqual(1);
    const blob = JSON.stringify(audits[0]) + audits[0]!.commentaire;
    expect(blob).not.toContain(mdpEnvoye);

    // 7. Login avec le nouveau mdp temporaire → 200 + flag dcm=true.
    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: cibleEmail, motDePasse: mdpEnvoye })
      .expect(200);
    expect(loginRes.body.doitChangerMdp).toBe(true);
  });
});
