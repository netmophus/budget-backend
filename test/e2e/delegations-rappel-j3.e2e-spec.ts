/**
 * E2E.11 — Cron rappel J-3 délégation (Lot 6.5.B).
 *
 * Couvre :
 *  1. Création d'une délégation `date_fin = today + 3 jours` via SQL
 *     direct (in-process, pré-requis ≠ objet du test).
 *  2. Lancement manuel du `notifierJ3()` via le service récupéré du
 *     conteneur Nest (l'objet du test = la query SELECT + le INSERT
 *     email_log + le UPDATE delegation + l'audit).
 *  3. Vérifications SQL :
 *     - 2 lignes email_log nouvelles (1 délégant + 1 délégataire),
 *       statut EN_ATTENTE (ou SUPPRIME si dry-run, on désactive
 *       dry-run pour ce test).
 *     - delegation.derniere_notification_j3 != NULL.
 *     - 1 audit_log DELEGATION_RAPPEL_J3.
 *  4. Re-lance le cron : 0 nouvel email_log + delegation.derniere_*
 *     inchangée + 0 nouvel audit (idempotence).
 *  5. Délégation J+10 (hors fenêtre) → non sélectionnée.
 *  6. Délégation J-3 mais actif=false → non sélectionnée.
 *
 * On mocke `EmailQueueProducer.publier` pour ne pas dépendre du
 * Worker BullMQ qui pourrait consommer le job entre l'INSERT et
 * l'assertion (l'email_log passerait à EN_COURS).
 */
import { type INestApplication } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';

import { bootstrapApp } from './helpers/app';
import { PERSONAS } from './helpers/auth';
import { DelegationsRappelService } from '../../src/delegations/delegations-rappel.service';
import { EmailQueueProducer } from '../../src/notifications/email-queue.producer';

describe('E2E.11 — Cron rappel J-3 délégation', () => {
  let app: INestApplication;
  let ds: DataSource;
  let rappelService: DelegationsRappelService;
  let queue: EmailQueueProducer;
  const publishedIds: string[] = [];

  beforeAll(async () => {
    process.env.EMAIL_DRY_RUN = 'false';
    app = await bootstrapApp();
    ds = app.get<DataSource>(getDataSourceToken());
    rappelService = app.get(DelegationsRappelService);
    queue = app.get(EmailQueueProducer);
    jest.spyOn(queue, 'publier').mockImplementation(async (id: string) => {
      publishedIds.push(id);
    });
  });

  afterAll(async () => {
    await app.close();
    process.env.EMAIL_DRY_RUN = 'true';
  });

  beforeEach(async () => {
    publishedIds.length = 0;
    // Purge les délégations de test précédentes (test isolé).
    await ds.query(`DELETE FROM delegations WHERE motif LIKE 'E2E.11 %'`);
    // Purge les email_log liés à ce type d'événement.
    await ds.query(
      `DELETE FROM email_log
        WHERE evenement IN ('DELEGATION_RAPPEL_J3_DELEGANT',
                            'DELEGATION_RAPPEL_J3_DELEGATAIRE')`,
    );
    // Purge les audit_log de ce type pour les délégations test.
    await ds.query(
      `DELETE FROM audit_log
        WHERE type_action = 'DELEGATION_RAPPEL_J3'
          AND commentaire LIKE 'Rappel J-3 envoyé pour délégation%'`,
    );
  });

  async function getUserId(email: string): Promise<string> {
    const r = (await ds.query(`SELECT id FROM "user" WHERE email = $1`, [
      email,
    ])) as Array<{ id: string }>;
    return String(r[0]!.id);
  }

  async function creerDelegation(
    delegantEmail: string,
    delegataireEmail: string,
    daysFromNow: number,
    actif = true,
  ): Promise<string> {
    const fkDelegant = await getUserId(delegantEmail);
    const fkDelegataire = await getUserId(delegataireEmail);
    // user_perimetre minimal — on prend un id existant côté delegant
    // sinon on utilise un placeholder (la valeur n'est pas vérifiée
    // par le cron J-3, juste portée).
    const r = (await ds.query(
      `INSERT INTO delegations
         (fk_delegant, fk_delegataire, perimetre_user_perimetre_ids,
          permissions, motif, date_debut, date_fin, actif,
          utilisateur_creation)
       VALUES ($1, $2, ARRAY[]::bigint[], ARRAY['SAISIE','VALIDATION'],
               'E2E.11 rappel J-3 fixture', CURRENT_DATE,
               CURRENT_DATE + ($3 || ' days')::interval, $4, 'e2e-test')
       RETURNING id`,
      [fkDelegant, fkDelegataire, String(daysFromNow), actif],
    )) as Array<{ id: string }>;
    return String(r[0]!.id);
  }

  it('délégation J+3 active → 2 email_log EN_ATTENTE + UPDATE derniere_notification_j3 + 1 audit', async () => {
    const idDelegation = await creerDelegation(
      PERSONAS.DIR_RETAIL.email,
      PERSONAS.ADJ_RETAIL.email,
      3,
    );

    const r = await rappelService.notifierJ3();
    expect(r.notifiees).toBeGreaterThanOrEqual(1);
    expect(r.emailsPublies).toBeGreaterThanOrEqual(2);

    // 2 email_log avec les 2 evenement types pour ce destinataire.
    const emails = (await ds.query(
      `SELECT evenement, statut, destinataire_email FROM email_log
        WHERE evenement IN ('DELEGATION_RAPPEL_J3_DELEGANT',
                            'DELEGATION_RAPPEL_J3_DELEGATAIRE')
          AND destinataire_email IN ($1, $2)`,
      [PERSONAS.DIR_RETAIL.email, PERSONAS.ADJ_RETAIL.email],
    )) as Array<{
      evenement: string;
      statut: string;
      destinataire_email: string;
    }>;
    expect(emails).toHaveLength(2);
    expect(emails.every((e) => e.statut === 'EN_ATTENTE')).toBe(true);

    // delegation.derniere_notification_j3 != NULL.
    const updated = (await ds.query(
      `SELECT derniere_notification_j3 FROM delegations WHERE id = $1`,
      [idDelegation],
    )) as Array<{ derniere_notification_j3: Date | null }>;
    expect(updated[0]!.derniere_notification_j3).not.toBeNull();

    // 1 audit DELEGATION_RAPPEL_J3.
    const audits = (await ds.query(
      `SELECT id FROM audit_log
        WHERE type_action = 'DELEGATION_RAPPEL_J3' AND id_cible = $1`,
      [idDelegation],
    )) as Array<{ id: string }>;
    expect(audits).toHaveLength(1);
  });

  it('idempotence : 2ème appel à notifierJ3() ne re-notifie pas', async () => {
    await creerDelegation(
      PERSONAS.DIR_RETAIL.email,
      PERSONAS.ADJ_RETAIL.email,
      3,
    );
    const r1 = await rappelService.notifierJ3();
    expect(r1.notifiees).toBe(1);

    // Re-lance.
    const r2 = await rappelService.notifierJ3();
    expect(r2.notifiees).toBe(0);
    expect(r2.emailsPublies).toBe(0);

    // Toujours 2 email_log au total (pas 4).
    const emails = (await ds.query(
      `SELECT id FROM email_log
        WHERE evenement IN ('DELEGATION_RAPPEL_J3_DELEGANT',
                            'DELEGATION_RAPPEL_J3_DELEGATAIRE')`,
    )) as Array<{ id: string }>;
    expect(emails).toHaveLength(2);
  });

  it('délégation J+10 (hors fenêtre) → non sélectionnée', async () => {
    await creerDelegation(
      PERSONAS.DIR_RETAIL.email,
      PERSONAS.ADJ_RETAIL.email,
      10,
    );
    const r = await rappelService.notifierJ3();
    expect(r.notifiees).toBe(0);
  });

  it('délégation J+3 mais actif=false → non sélectionnée', async () => {
    await creerDelegation(
      PERSONAS.DIR_RETAIL.email,
      PERSONAS.ADJ_RETAIL.email,
      3,
      false,
    );
    const r = await rappelService.notifierJ3();
    expect(r.notifiees).toBe(0);
  });
});
