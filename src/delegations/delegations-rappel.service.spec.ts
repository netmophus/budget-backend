/**
 * Tests unitaires DelegationsRappelService (Lot 6.5.B).
 *
 * Couvre :
 *  - 0 délégation matchée → notifiees=0, pas d'audit, pas d'email.
 *  - 1 délégation matchée → 2 emails publiés + UPDATE derniere_notification_j3
 *    + 1 audit DELEGATION_RAPPEL_J3.
 *  - User délégant a opt-out global → email_log SUPPRIME (pas de
 *    publication queue) ; le délégataire reçoit toujours.
 *  - User délégataire a opt-out spécifique au type → SUPPRIME.
 *  - Garde-fou findOne null après le SELECT des matches → skip
 *    silencieusement (cas où la délégation a été désactivée entre
 *    le SELECT et le findOne).
 *
 * On mocke le repo Delegation.query (raw SQL) et findOne, le repo
 * EmailLog.save, le repo User.findOne, l'AuditService et
 * l'EmailQueueProducer.
 */
import { ConfigService } from '@nestjs/config';

import { AuditService } from '../audit/audit.service';
import { EmailQueueProducer } from '../notifications/email-queue.producer';
import { DelegationsRappelService } from './delegations-rappel.service';
import { Delegation } from './entities/delegation.entity';
import { User } from '../users/entities/user.entity';

interface CapturedAudit {
  typeAction: string;
  payloadApres?: object | null;
}
interface CapturedEmail {
  evenement: string;
  destinataireEmail: string;
  statut: string;
  payload: Record<string, unknown>;
  id: string;
}
interface Counters {
  audits: CapturedAudit[];
  emails: CapturedEmail[];
  publishedIds: string[];
  delegationsSaved: Delegation[];
}

function buildUser(overrides: Partial<User> = {}): User {
  return {
    id: '1',
    email: 'jean@miznas.local',
    nom: 'Dupont',
    prenom: 'Jean',
    notificationsEmailActives: true,
    notificationsEmailTypes: null,
    ...overrides,
  } as unknown as User;
}

function buildDelegation(overrides: Partial<Delegation> = {}): Delegation {
  return {
    id: '42',
    fkDelegant: '10',
    fkDelegataire: '20',
    permissions: ['SAISIE', 'VALIDATION'],
    motif: 'Congés du manager',
    dateDebut: '2026-05-01',
    dateFin: '2026-05-13',
    actif: true,
    revoqueeLe: null,
    fkRevoquePar: null,
    motifRevocation: null,
    derniereNotificationJ3: null,
    perimetreUserPerimetreIds: ['100'],
    dateCreation: new Date(),
    utilisateurCreation: 'admin',
    dateModification: null,
    utilisateurModification: null,
    delegant: buildUser({
      id: '10',
      email: 'manager@miznas.local',
      nom: 'Manager',
      prenom: 'Marie',
    }),
    delegataire: buildUser({
      id: '20',
      email: 'adjoint@miznas.local',
      nom: 'Adjoint',
      prenom: 'Adam',
    }),
    ...overrides,
  } as unknown as Delegation;
}

interface BuildOpts {
  matches?: Array<{ id: string }>;
  delegationFinale?: Delegation | null;
}

function buildService(opts: BuildOpts = {}): {
  service: DelegationsRappelService;
  capt: Counters;
} {
  const capt: Counters = {
    audits: [],
    emails: [],
    publishedIds: [],
    delegationsSaved: [],
  };

  const delegationRepo = {
    query: jest.fn(async () => opts.matches ?? []),
    findOne: jest.fn(async () =>
      opts.delegationFinale === undefined
        ? buildDelegation()
        : opts.delegationFinale,
    ),
    save: jest.fn(async (d: Delegation) => {
      capt.delegationsSaved.push(d);
      return d;
    }),
  };

  const emailLogRepo = {
    create: (l: Partial<CapturedEmail>): CapturedEmail =>
      ({ ...l, id: 'auto' }) as CapturedEmail,
    save: jest.fn(async (l: CapturedEmail) => {
      const saved = { ...l, id: String(capt.emails.length + 1) };
      capt.emails.push(saved);
      return saved;
    }),
  };

  const userRepo = { findOne: jest.fn() };

  const auditService = {
    log: jest.fn(async (a: CapturedAudit) => {
      capt.audits.push(a);
    }),
  };

  const emailQueue = {
    publier: jest.fn(async (id: string) => {
      capt.publishedIds.push(id);
    }),
  };

  const config = {
    get: (key: string, defaultValue?: string): string =>
      key === 'EMAIL_DRY_RUN' ? 'false' : (defaultValue ?? ''),
  };

  const service = new DelegationsRappelService(
    delegationRepo as never,
    userRepo as never,
    emailLogRepo as never,
    auditService as unknown as AuditService,
    emailQueue as unknown as EmailQueueProducer,
    config as unknown as ConfigService,
  );
  return { service, capt };
}

describe('DelegationsRappelService — notifierJ3', () => {
  it("0 délégation matchée → notifiees=0, pas d'email, pas d'audit", async () => {
    const { service, capt } = buildService({ matches: [] });
    const r = await service.notifierJ3();
    expect(r.notifiees).toBe(0);
    expect(r.emailsPublies).toBe(0);
    expect(capt.emails).toHaveLength(0);
    expect(capt.publishedIds).toHaveLength(0);
    expect(capt.audits).toHaveLength(0);
  });

  it('1 délégation matchée → 2 emails publiés EN_ATTENTE + UPDATE derniere_notification_j3 + 1 audit', async () => {
    const { service, capt } = buildService({
      matches: [{ id: '42' }],
      delegationFinale: buildDelegation(),
    });
    const r = await service.notifierJ3();
    expect(r.notifiees).toBe(1);
    expect(r.emailsPublies).toBe(2);
    expect(r.emailsSupprimes).toBe(0);
    // 2 email_log EN_ATTENTE (1 délégant + 1 délégataire).
    expect(capt.emails).toHaveLength(2);
    const types = capt.emails.map((e) => e.evenement).sort();
    expect(types).toEqual([
      'DELEGATION_RAPPEL_J3_DELEGANT',
      'DELEGATION_RAPPEL_J3_DELEGATAIRE',
    ]);
    expect(capt.emails.every((e) => e.statut === 'EN_ATTENTE')).toBe(true);
    expect(capt.publishedIds).toHaveLength(2);
    // Audit DELEGATION_RAPPEL_J3 unique.
    expect(capt.audits).toHaveLength(1);
    expect(capt.audits[0]!.typeAction).toBe('DELEGATION_RAPPEL_J3');
    // UPDATE derniere_notification_j3 (Date objet).
    expect(capt.delegationsSaved).toHaveLength(1);
    expect(capt.delegationsSaved[0]!.derniereNotificationJ3).toBeInstanceOf(
      Date,
    );
  });

  it('délégant opt-out global → email SUPPRIME + délégataire reçoit normalement', async () => {
    const optedOut = buildUser({
      id: '10',
      email: 'manager@miznas.local',
      notificationsEmailActives: false,
    });
    const { service, capt } = buildService({
      matches: [{ id: '42' }],
      delegationFinale: buildDelegation({ delegant: optedOut }),
    });
    await service.notifierJ3();
    expect(capt.emails).toHaveLength(2);
    const delegantLog = capt.emails.find(
      (e) => e.evenement === 'DELEGATION_RAPPEL_J3_DELEGANT',
    )!;
    expect(delegantLog.statut).toBe('SUPPRIME');
    expect(delegantLog.payload._motifSuppression).toBe(
      'PREF_TOGGLE_GLOBAL_OFF',
    );
    const delegataireLog = capt.emails.find(
      (e) => e.evenement === 'DELEGATION_RAPPEL_J3_DELEGATAIRE',
    )!;
    expect(delegataireLog.statut).toBe('EN_ATTENTE');
    // Une seule publication queue (le délégant supprimé n'est pas publié).
    expect(capt.publishedIds).toHaveLength(1);
  });

  it('délégataire opt-out spécifique du type → SUPPRIME (PREF_TYPE_NON_SOUSCRIT)', async () => {
    const optedOutType = buildUser({
      id: '20',
      email: 'adjoint@miznas.local',
      notificationsEmailActives: true,
      notificationsEmailTypes: ['BUDGET_PUBLIE', 'DELEGATION_CREEE'],
    });
    const { service, capt } = buildService({
      matches: [{ id: '42' }],
      delegationFinale: buildDelegation({ delegataire: optedOutType }),
    });
    await service.notifierJ3();
    const log = capt.emails.find(
      (e) => e.evenement === 'DELEGATION_RAPPEL_J3_DELEGATAIRE',
    )!;
    expect(log.statut).toBe('SUPPRIME');
    expect(log.payload._motifSuppression).toBe('PREF_TYPE_NON_SOUSCRIT');
  });

  it('garde-fou : findOne renvoie null (délégation modifiée entre SELECT et boucle) → skip silencieux', async () => {
    const { service, capt } = buildService({
      matches: [{ id: '42' }],
      delegationFinale: null,
    });
    const r = await service.notifierJ3();
    // Le SELECT a trouvé 1 match, mais le findOne renvoie null
    // (la délégation a été désactivée entre temps). On compte
    // toujours 1 dans `notifiees` (au sens "nombre matché"), mais
    // aucun email ni audit.
    expect(r.notifiees).toBe(1);
    expect(r.emailsPublies).toBe(0);
    expect(capt.emails).toHaveLength(0);
    expect(capt.audits).toHaveLength(0);
  });

  it('EMAIL_DRY_RUN=true → tous les email_log SUPPRIME (jamais publiés en queue)', async () => {
    // Re-construire le service avec dryRun=true.
    const capt: Counters = {
      audits: [],
      emails: [],
      publishedIds: [],
      delegationsSaved: [],
    };
    const delegationRepo = {
      query: jest.fn(async () => [{ id: '42' }]),
      findOne: jest.fn(async () => buildDelegation()),
      save: jest.fn(async (d: Delegation) => {
        capt.delegationsSaved.push(d);
        return d;
      }),
    };
    const emailLogRepo = {
      create: (l: Partial<CapturedEmail>) => ({ ...l, id: 'auto' }),
      save: jest.fn(async (l: CapturedEmail) => {
        const saved = { ...l, id: String(capt.emails.length + 1) };
        capt.emails.push(saved);
        return saved;
      }),
    };
    const userRepo = { findOne: jest.fn() };
    const auditService = {
      log: jest.fn(async (a: CapturedAudit) => {
        capt.audits.push(a);
      }),
    };
    const emailQueue = {
      publier: jest.fn(async (id: string) => {
        capt.publishedIds.push(id);
      }),
    };
    const config = {
      get: (k: string, def?: string): string =>
        k === 'EMAIL_DRY_RUN' ? 'true' : (def ?? ''),
    };
    const service = new DelegationsRappelService(
      delegationRepo as never,
      userRepo as never,
      emailLogRepo as never,
      auditService as unknown as AuditService,
      emailQueue as unknown as EmailQueueProducer,
      config as unknown as ConfigService,
    );
    const r = await service.notifierJ3();
    expect(r.emailsPublies).toBe(0);
    expect(r.emailsSupprimes).toBe(2);
    expect(capt.emails.every((e) => e.statut === 'SUPPRIME')).toBe(true);
    expect(capt.publishedIds).toHaveLength(0);
  });
});
