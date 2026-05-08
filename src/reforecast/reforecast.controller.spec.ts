/**
 * Tests ReforecastController (Lot 5.3.A) — vérifie le routage et
 * la délégation aux services. Les tests d'intégration profonds
 * (RBAC, ValidationPipe) sont couverts par les autres specs ;
 * ce fichier valide la couche controller avec des services mockés.
 */
import { ReforecastController } from './reforecast.controller';
import type {
  LancerReforecastDto,
  ReforecastResponseDto,
} from './dto/reforecast.dto';
import type { ReforecastService } from './reforecast.service';
import type { VersionWorkflowService } from '../referentiels/version/version-workflow.service';
import type { BudgetSaisieService } from '../budget/services/budget-saisie.service';
import type { AuthUser } from '../auth/decorators/current-user.decorator';

const USER: AuthUser = { userId: 'u1', email: 'u@m.io' };

function makeServiceMock(
  over: Partial<jest.Mocked<ReforecastService>> = {},
): jest.Mocked<ReforecastService> {
  const stub = {
    lancer: jest.fn(),
    lister: jest.fn().mockResolvedValue([]),
    getById: jest.fn(),
    getEntityById: jest.fn(),
    getComparaison: jest.fn(),
  } as unknown as jest.Mocked<ReforecastService>;
  return Object.assign(stub, over);
}

function makeWorkflowMock(): jest.Mocked<VersionWorkflowService> {
  return {
    soumettre: jest.fn(),
    valider: jest.fn(),
    rejeter: jest.fn(),
    publier: jest.fn(),
  } as unknown as jest.Mocked<VersionWorkflowService>;
}

function makeBudgetSaisieMock(): jest.Mocked<BudgetSaisieService> {
  return {
    getGrilleSaisie: jest.fn().mockResolvedValue({
      lignes: [],
      moisLabels: [],
    }),
  } as unknown as jest.Mocked<BudgetSaisieService>;
}

const REF_OK: ReforecastResponseDto = {
  id: '42',
  codeVersion: 'REFORECAST_T1_2027_999',
  libelle: 'Reforecast T1 2027',
  exerciceFiscal: 2027,
  statut: 'ouvert',
  statutPublication: 'ACTIVE',
  fkVersionSource: '1',
  fkScenarioSource: '1',
  trimestreConsolide: 1,
  anneeConsolide: 2027,
  methodeExtrapolation: 'BUDGET_INITIAL',
  dateObsolescence: null,
  fkVersionRemplacante: null,
  libelleVersionSource: 'Budget initial',
  libelleScenarioSource: 'Optimiste',
  dateCreation: new Date(),
  utilisateurCreation: 'u@m.io',
  commentaire: null,
};

describe('ReforecastController', () => {
  it('POST /lancer délègue au service avec dto + user', async () => {
    const svc = makeServiceMock();
    svc.lancer.mockResolvedValue(REF_OK);
    const ctrl = new ReforecastController(
      svc,
      makeWorkflowMock(),
      makeBudgetSaisieMock(),
    );
    const dto: LancerReforecastDto = {
      fkVersionSource: '1',
      fkScenarioSource: '1',
      trimestreConsolide: 1,
      anneeConsolide: 2027,
      methodeExtrapolation: 'BUDGET_INITIAL',
      libelleNouveauVersion: 'r1',
    };
    const r = await ctrl.lancer(dto, USER);
    expect(svc.lancer).toHaveBeenCalledWith(dto, USER);
    expect(r.id).toBe('42');
  });

  it('GET / lister applique mapStatutWorkflowParam (BROUILLON → ouvert)', async () => {
    const svc = makeServiceMock();
    const ctrl = new ReforecastController(
      svc,
      makeWorkflowMock(),
      makeBudgetSaisieMock(),
    );
    await ctrl.lister({ statutWorkflow: 'BROUILLON' as never });
    expect(svc.lister).toHaveBeenCalledWith({
      statutWorkflow: 'ouvert',
    });
  });

  it('GET / lister sans filtre passe statutWorkflow undefined', async () => {
    const svc = makeServiceMock();
    const ctrl = new ReforecastController(
      svc,
      makeWorkflowMock(),
      makeBudgetSaisieMock(),
    );
    await ctrl.lister({});
    expect(svc.lister).toHaveBeenCalledWith({ statutWorkflow: undefined });
  });

  it('GET /:id délègue à getById', async () => {
    const svc = makeServiceMock();
    svc.getById.mockResolvedValue(REF_OK);
    const ctrl = new ReforecastController(
      svc,
      makeWorkflowMock(),
      makeBudgetSaisieMock(),
    );
    const r = await ctrl.getById('42');
    expect(svc.getById).toHaveBeenCalledWith('42');
    expect(r).toBe(REF_OK);
  });

  it('GET /:id/grille délègue à BudgetSaisieService avec scenarioId du reforecast', async () => {
    const svc = makeServiceMock();
    svc.getEntityById.mockResolvedValue({
      id: '42',
      fkScenarioSource: '7',
      exerciceFiscal: 2027,
    } as never);
    const budget = makeBudgetSaisieMock();
    const ctrl = new ReforecastController(svc, makeWorkflowMock(), budget);
    await ctrl.getGrille('42', 'cr1', 'lm1', undefined, USER);
    expect(svc.getEntityById).toHaveBeenCalledWith('42');
    expect(budget.getGrilleSaisie).toHaveBeenCalledWith(
      {
        versionId: '42',
        scenarioId: '7',
        crId: 'cr1',
        exerciceFiscal: 2027,
        ligneMetierId: 'lm1',
      },
      'u1',
    );
  });

  it('GET /:id/comparaison délègue au service', async () => {
    const svc = makeServiceMock();
    svc.getComparaison.mockResolvedValue({
      lignes: [],
      totalSource: 0,
      totalReforecast: 0,
      totalEcart: 0,
    });
    const ctrl = new ReforecastController(
      svc,
      makeWorkflowMock(),
      makeBudgetSaisieMock(),
    );
    const r = await ctrl.getComparaison('42');
    expect(svc.getComparaison).toHaveBeenCalledWith('42');
    expect(r.totalEcart).toBe(0);
  });

  it("POST /:id/soumettre vérifie type='reforecast' avant de déléguer au workflow", async () => {
    const svc = makeServiceMock();
    svc.getEntityById.mockResolvedValue({} as never);
    svc.getById.mockResolvedValue(REF_OK);
    const wf = makeWorkflowMock();
    const ctrl = new ReforecastController(svc, wf, makeBudgetSaisieMock());
    await ctrl.soumettre('42', {}, USER);
    // getEntityById appelé en premier (404 si pas reforecast)
    expect(svc.getEntityById).toHaveBeenCalledWith('42');
    expect(wf.soumettre).toHaveBeenCalledWith('42', {}, USER);
  });

  it('POST /:id/rejeter passe le motif obligatoire au workflow', async () => {
    const svc = makeServiceMock();
    svc.getEntityById.mockResolvedValue({} as never);
    svc.getById.mockResolvedValue(REF_OK);
    const wf = makeWorkflowMock();
    const ctrl = new ReforecastController(svc, wf, makeBudgetSaisieMock());
    await ctrl.rejeter('42', { commentaire: 'Mauvaise méthode' }, USER);
    expect(wf.rejeter).toHaveBeenCalledWith(
      '42',
      { commentaire: 'Mauvaise méthode' },
      USER,
    );
  });
});
