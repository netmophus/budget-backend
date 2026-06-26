/**
 * Tests AlerteEcartService (Lot 8.5.E) via mocks complets.
 *
 * On mock les 4 dépendances (DataSource pour les 2 requêtes de résolution
 * version+scenario+admin, AnalyseEcartsService, NotificationsService,
 * AuditService) pour rester rapide et déterministe — pas de pg-mem ici
 * (pas de logique SQL métier propre à tester, juste de l'orchestration).
 *
 * Couvre les 6 cas du brief 8.5.E :
 *  1. Happy : 2 ATTENTION + 1 CRITIQUE + 4 destinataires → 4 envois +
 *     1 audit success.
 *  2. Edge : 0 écart filtré (lignes vides) → 0 envoi + audit skip.
 *  3. Edge : seulement NORMAL en sortie → 0 envoi + audit skip.
 *  4. Edge : seulement MANQUANT en sortie → 0 envoi + audit skip.
 *  5. Erreur : notif.envoyer throw pour 1 destinataire → continue + audit failure.
 *  6. Skip : aucune version publiée trouvée → 0 appel analyse + audit skip.
 */
import type { DataSource } from 'typeorm';

import { AuditService } from '../../audit/audit.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { AnalyseEcartsService } from '../../tableau-de-bord/services/analyse-ecarts.service';
import type {
  EcartsResponseDto,
  LigneEcartDto,
  NiveauAlerte,
} from '../../tableau-de-bord/dto/tableau-bord.dto';
import type { User } from '../../users/entities/user.entity';
import { AlerteEcartService } from './alerte-ecart.service';

function ligne(
  niveau: NiveauAlerte,
  override: Partial<LigneEcartDto> = {},
): LigneEcartDto {
  return {
    codeCr: 'CR_DARH',
    libelleCr: 'Dir. Admin & RH',
    codeCompte: '641000',
    libelleCompte: 'Salaires',
    classeCompte: '6',
    natureCompte: 'CHARGE',
    codeLigneMetier: 'CHANGE',
    mois: '2026-05',
    libelleMois: 'Mai 2026',
    montantBudget: 200000000,
    montantRealise: 220000000,
    ecart: 20000000,
    ecartAbs: 20000000,
    ecartPct: 10,
    tauxExecution: 110,
    niveauAlerte: niveau,
    sensEcart: 'DEFAVORABLE',
    ...override,
  };
}

function ecartsResponse(lignes: LigneEcartDto[]): EcartsResponseDto {
  return {
    filtres: {
      versionId: '1',
      scenarioId: '1',
      moisDebut: '2026-05',
      moisFin: '2026-05',
      seuilEcartPctAttention: 5,
      seuilEcartPctCritique: 10,
    },
    kpi: {
      nbEcartsTotal: lignes.length,
      nbEcartsCritique: lignes.filter((l) => l.niveauAlerte === 'CRITIQUE')
        .length,
      nbEcartsAttention: lignes.filter((l) => l.niveauAlerte === 'ATTENTION')
        .length,
      nbLignesManquantes: lignes.filter((l) => l.niveauAlerte === 'MANQUANT')
        .length,
      nbSansBudget: lignes.filter((l) => l.niveauAlerte === 'SANS_BUDGET')
        .length,
      ecartTotalAbs: 0,
      ecartTotalDefavorable: 0,
      ecartTotalFavorable: 0,
    },
    totaux: {
      produits: { budget: 0, realise: 0, ecart: 0, tauxExecution: null },
      charges: { budget: 0, realise: 0, ecart: 0, tauxExecution: null },
      solde: { budget: 0, realise: 0, ecart: 0, tauxExecution: null },
      pnb: { budget: 0, realise: 0, ecart: 0, tauxExecution: null },
      coefExploitationBudget: null,
      coefExploitationRealise: null,
    },
    lignes,
  };
}

function mockUser(id: string, email: string): User {
  return { id, email, prenom: 'Jean', nom: 'Test' } as unknown as User;
}

interface QueryMock {
  fn: jest.Mock;
}

function makeDataSourceMock(): { ds: DataSource; query: QueryMock } {
  const fn = jest.fn();
  const ds = { query: fn } as unknown as DataSource;
  return { ds, query: { fn } };
}

/**
 * Set up un scénario où DataSource.query retourne en séquence :
 *   1er appel = admin trouvé
 *   2e appel  = version trouvée (avec fk_scenario_source = '1')
 *   3e appel  = scenario résolu via fk_scenario_source
 */
function primeHappyDbResolutions(query: QueryMock): void {
  query.fn
    .mockResolvedValueOnce([{ id: '1' }]) // admin
    .mockResolvedValueOnce([
      { id: '10', code_version: 'BUDGET_2026_v1.0', fk_scenario_source: '5' },
    ]) // version
    .mockResolvedValueOnce([{ id: '5', code_scenario: 'SCN_2026_CENTRAL' }]); // scenario
}

describe('AlerteEcartService', () => {
  let svc: AlerteEcartService;
  let dsMock: { ds: DataSource; query: QueryMock };
  let analyseService: jest.Mocked<AnalyseEcartsService>;
  let notifService: jest.Mocked<NotificationsService>;
  let auditService: jest.Mocked<AuditService>;

  beforeEach(() => {
    dsMock = makeDataSourceMock();
    analyseService = {
      getBudgetVsRealise: jest.fn(),
    } as unknown as jest.Mocked<AnalyseEcartsService>;
    notifService = {
      resoudreDestinataires: jest.fn(),
      envoyer: jest.fn(),
    } as unknown as jest.Mocked<NotificationsService>;
    auditService = {
      log: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<AuditService>;
    svc = new AlerteEcartService(
      dsMock.ds,
      analyseService,
      notifService,
      auditService,
    );
  });

  it('1. Happy : 2 ATTENTION + 1 CRITIQUE + 4 destinataires → 4 envois + audit success', async () => {
    primeHappyDbResolutions(dsMock.query);
    analyseService.getBudgetVsRealise.mockResolvedValue(
      ecartsResponse([
        ligne('ATTENTION', { codeCompte: '641000' }),
        ligne('ATTENTION', { codeCompte: '702121' }),
        ligne('CRITIQUE', { codeCompte: '702930' }),
        ligne('NORMAL', { codeCompte: '601735' }), // filtré
        ligne('MANQUANT', { codeCompte: '622100' }), // filtré
      ]),
    );
    notifService.resoudreDestinataires.mockResolvedValue([
      mockUser('1', 'admin@miznas.local'),
      mockUser('2', 'dga.dev@bsic.ne'),
      mockUser('3', 'dga.ops@bsic.ne'),
      mockUser('4', 'pdt.ca@bsic.ne'),
    ]);
    notifService.envoyer.mockResolvedValue({
      emailLog: { id: 'log' } as never,
      envoye: true,
    });

    const r = await svc.notifierEcarts('2026-05');

    expect(r.execute).toBe(true);
    expect(r.moisAnalyse).toBe('2026-05');
    expect(r.nbDestinataires).toBe(4);
    expect(r.nbAttention).toBe(2);
    expect(r.nbCritique).toBe(1);
    expect(r.nbErreursEnvoi).toBe(0);
    expect(notifService.envoyer).toHaveBeenCalledTimes(4);
    // Le payload de chaque envoi doit contenir les 2 attentions et 1 critique
    // (les 5 écarts NORMAL + MANQUANT ne doivent pas y être).
    const payload = notifService.envoyer.mock.calls[0]![2] as Record<
      string,
      unknown
    >;
    expect((payload.attentions as unknown[]).length).toBe(2);
    expect((payload.critiques as unknown[]).length).toBe(1);
    expect(payload.codeVersion).toBe('BUDGET_2026_v1.0');
    expect(payload.codeScenario).toBe('SCN_2026_CENTRAL');
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        typeAction: 'ALERTE_ECART_REALISE_ENVOYEE',
        statut: 'success',
        idCible: '2026-05',
      }),
    );
  });

  it('2. Edge : 0 ligne en sortie d\'analyse → 0 envoi + audit skip "no_ecart"', async () => {
    primeHappyDbResolutions(dsMock.query);
    analyseService.getBudgetVsRealise.mockResolvedValue(ecartsResponse([]));

    const r = await svc.notifierEcarts('2026-05');

    expect(r.execute).toBe(false);
    expect(r.skipReason).toBe('no_ecart');
    expect(r.nbAttention).toBe(0);
    expect(r.nbCritique).toBe(0);
    expect(notifService.envoyer).not.toHaveBeenCalled();
    expect(notifService.resoudreDestinataires).not.toHaveBeenCalled();
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        statut: 'success',
        commentaire: expect.stringMatching(/0 écart/),
      }),
    );
  });

  it('3. Edge : seulement NORMAL en sortie → 0 envoi (filtré correctement)', async () => {
    primeHappyDbResolutions(dsMock.query);
    analyseService.getBudgetVsRealise.mockResolvedValue(
      ecartsResponse([
        ligne('NORMAL', { codeCompte: '641000' }),
        ligne('NORMAL', { codeCompte: '702121' }),
      ]),
    );

    const r = await svc.notifierEcarts('2026-05');

    expect(r.execute).toBe(false);
    expect(r.skipReason).toBe('no_ecart');
    expect(notifService.envoyer).not.toHaveBeenCalled();
  });

  it('4. Edge : seulement MANQUANT en sortie → 0 envoi (MANQUANT exclu)', async () => {
    primeHappyDbResolutions(dsMock.query);
    analyseService.getBudgetVsRealise.mockResolvedValue(
      ecartsResponse([
        ligne('MANQUANT', { codeCompte: '622100' }),
        ligne('MANQUANT', { codeCompte: '707210' }),
      ]),
    );

    const r = await svc.notifierEcarts('2026-05');

    expect(r.execute).toBe(false);
    expect(r.skipReason).toBe('no_ecart');
    expect(notifService.envoyer).not.toHaveBeenCalled();
  });

  it('5. Erreur : notif.envoyer throw pour 1 destinataire → continue + audit failure', async () => {
    primeHappyDbResolutions(dsMock.query);
    analyseService.getBudgetVsRealise.mockResolvedValue(
      ecartsResponse([ligne('CRITIQUE')]),
    );
    notifService.resoudreDestinataires.mockResolvedValue([
      mockUser('1', 'a@x.io'),
      mockUser('2', 'b@x.io'),
      mockUser('3', 'c@x.io'),
    ]);
    notifService.envoyer
      .mockResolvedValueOnce({ emailLog: { id: 'l1' } as never, envoye: true })
      .mockRejectedValueOnce(new Error('SMTP down'))
      .mockResolvedValueOnce({ emailLog: { id: 'l3' } as never, envoye: true });

    const r = await svc.notifierEcarts('2026-05');

    expect(r.execute).toBe(true);
    expect(r.nbDestinataires).toBe(3);
    expect(r.nbErreursEnvoi).toBe(1);
    expect(notifService.envoyer).toHaveBeenCalledTimes(3);
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        statut: 'failure',
      }),
    );
  });

  it('6. Skip : aucune version publiée trouvée → 0 appel analyse + audit skip "no_version_scenario"', async () => {
    // admin trouvé, mais 0 version sur l'exercice
    dsMock.query.fn
      .mockResolvedValueOnce([{ id: '1' }]) // admin
      .mockResolvedValueOnce([]); // aucune version

    const r = await svc.notifierEcarts('2026-05');

    expect(r.execute).toBe(false);
    expect(r.skipReason).toBe('no_version_scenario');
    expect(analyseService.getBudgetVsRealise).not.toHaveBeenCalled();
    expect(notifService.envoyer).not.toHaveBeenCalled();
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        statut: 'success',
        commentaire: expect.stringMatching(/aucune version/),
      }),
    );
  });
});
