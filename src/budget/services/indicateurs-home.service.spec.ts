/**
 * Tests unitaires IndicateursHomeService (Lot 7.2).
 *
 * Couvre la logique de résolution du triplet (version / scénario /
 * exercice) sans monter pg-mem : Repository<DimVersion>,
 * Repository<DimScenario> et IndicateursService sont mockés. Les
 * tests e2e (indicateurs.e2e.spec.ts) couvrent le câblage HTTP +
 * permission.
 */
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import type { AuthUser } from '../../auth/decorators/current-user.decorator';
import { DimScenario } from '../../referentiels/scenario/entities/dim-scenario.entity';
import { DimVersion } from '../../referentiels/version/entities/dim-version.entity';
import { IndicateursGlobauxDto } from '../dto/indicateurs.dto';
import { IndicateursHomeService } from './indicateurs-home.service';
import { IndicateursService } from './indicateurs.service';

interface VersionFindOneArgs {
  where?: {
    statut?: string;
    statutPublication?: string;
  };
}

function buildVersion(over: Partial<DimVersion> = {}): DimVersion {
  return {
    id: '101',
    codeVersion: 'BI_2027',
    libelle: 'Budget initial 2027',
    typeVersion: 'budget_initial',
    exerciceFiscal: 2027,
    statut: 'gele',
    statutPublication: 'ACTIVE',
    ...over,
  } as DimVersion;
}

function buildScenario(over: Partial<DimScenario> = {}): DimScenario {
  return {
    id: '7',
    codeScenario: 'MEDIAN_2027',
    libelle: 'Médian 2027',
    typeScenario: 'central',
    statut: 'actif',
    exerciceFiscal: 2027,
    ...over,
  } as DimScenario;
}

const fakeIndicateurs: IndicateursGlobauxDto = {
  pnb: 1000,
  mni: 500,
  coefExploitation: 42.5,
  chargesHorsInterets: 425,
  totalProduits: 1100,
  totalCharges: 600,
  nbCrInclus: 3,
  derniereMaj: '2026-05-13T08:00:00.000Z',
};

const user: AuthUser = { userId: '999', email: 'test@miznas.local' };

describe('IndicateursHomeService', () => {
  let service: IndicateursHomeService;
  let versionFindOne: jest.Mock;
  let scenarioFindOne: jest.Mock;
  let getIndicateursGlobaux: jest.Mock;

  beforeEach(async () => {
    versionFindOne = jest.fn();
    scenarioFindOne = jest.fn();
    getIndicateursGlobaux = jest.fn().mockResolvedValue(fakeIndicateurs);

    const moduleRef = await Test.createTestingModule({
      providers: [
        IndicateursHomeService,
        {
          provide: getRepositoryToken(DimVersion),
          useValue: { findOne: versionFindOne },
        },
        {
          provide: getRepositoryToken(DimScenario),
          useValue: { findOne: scenarioFindOne },
        },
        {
          provide: IndicateursService,
          useValue: { getIndicateursGlobaux },
        },
      ],
    }).compile();

    service = moduleRef.get(IndicateursHomeService);
  });

  it('retourne defauts:null + indicateurs:null quand aucune version éligible', async () => {
    versionFindOne.mockResolvedValue(null);

    const res = await service.getHome(user);

    expect(res).toEqual({ defauts: null, indicateurs: null });
    // Cascade complète tentée : gele, puis valide, puis soumis.
    expect(versionFindOne).toHaveBeenCalledTimes(3);
    expect(scenarioFindOne).not.toHaveBeenCalled();
    expect(getIndicateursGlobaux).not.toHaveBeenCalled();
  });

  it('utilise la version `gele` en priorité (sans tenter valide/soumis)', async () => {
    const versionGele = buildVersion({ statut: 'gele' });
    versionFindOne.mockImplementation((args: VersionFindOneArgs) =>
      args.where?.statut === 'gele' ? versionGele : null,
    );
    scenarioFindOne.mockResolvedValue(buildScenario());

    const res = await service.getHome(user);

    expect(versionFindOne).toHaveBeenCalledTimes(1);
    expect(versionFindOne.mock.calls[0]?.[0]?.where?.statut).toBe('gele');
    expect(versionFindOne.mock.calls[0]?.[0]?.where?.statutPublication).toBe(
      'ACTIVE',
    );
    expect(res.defauts?.codeVersion).toBe('BI_2027');
    expect(res.indicateurs).toEqual(fakeIndicateurs);
  });

  it('fallback `valide` quand aucune `gele`', async () => {
    const versionValide = buildVersion({
      id: '202',
      codeVersion: 'BI_2027_V',
      statut: 'valide',
    });
    versionFindOne.mockImplementation((args: VersionFindOneArgs) =>
      args.where?.statut === 'valide' ? versionValide : null,
    );
    scenarioFindOne.mockResolvedValue(buildScenario());

    const res = await service.getHome(user);

    expect(versionFindOne).toHaveBeenCalledTimes(2);
    expect(versionFindOne.mock.calls[0]?.[0]?.where?.statut).toBe('gele');
    expect(versionFindOne.mock.calls[1]?.[0]?.where?.statut).toBe('valide');
    expect(res.defauts?.codeVersion).toBe('BI_2027_V');
  });

  it('fallback `soumis` quand ni `gele` ni `valide`', async () => {
    const versionSoumis = buildVersion({
      id: '303',
      codeVersion: 'BI_2027_S',
      statut: 'soumis',
    });
    versionFindOne.mockImplementation((args: VersionFindOneArgs) =>
      args.where?.statut === 'soumis' ? versionSoumis : null,
    );
    scenarioFindOne.mockResolvedValue(buildScenario());

    const res = await service.getHome(user);

    expect(versionFindOne).toHaveBeenCalledTimes(3);
    expect(versionFindOne.mock.calls[2]?.[0]?.where?.statut).toBe('soumis');
    expect(res.defauts?.codeVersion).toBe('BI_2027_S');
  });

  it('retourne defauts:null + indicateurs:null si version OK mais scénario central absent', async () => {
    versionFindOne.mockResolvedValue(buildVersion());
    scenarioFindOne.mockResolvedValue(null);

    const res = await service.getHome(user);

    expect(res).toEqual({ defauts: null, indicateurs: null });
    // 3 lookups scénario tentés (exercice exact, NULL, autre exercice).
    expect(scenarioFindOne).toHaveBeenCalledTimes(3);
    expect(getIndicateursGlobaux).not.toHaveBeenCalled();
  });

  it('délègue les indicateurs au IndicateursService avec le triplet résolu', async () => {
    versionFindOne.mockResolvedValue(buildVersion());
    scenarioFindOne.mockResolvedValue(buildScenario());

    await service.getHome(user);

    expect(getIndicateursGlobaux).toHaveBeenCalledTimes(1);
    expect(getIndicateursGlobaux).toHaveBeenCalledWith(
      { versionId: '101', scenarioId: '7', exerciceFiscal: 2027 },
      user,
    );
  });

  it('utilise le fallback scénario sans exerciceFiscal (héritage Lot 2.4)', async () => {
    versionFindOne.mockResolvedValue(buildVersion());
    const scenarioHeritage = buildScenario({
      id: '99',
      codeScenario: 'MEDIAN_LEGACY',
      exerciceFiscal: null,
    });
    let call = 0;
    scenarioFindOne.mockImplementation(() => {
      call += 1;
      // 1er appel : exercice exact → rien.
      // 2e appel : exerciceFiscal IS NULL → trouvé.
      return call === 2 ? scenarioHeritage : null;
    });

    const res = await service.getHome(user);

    expect(scenarioFindOne).toHaveBeenCalledTimes(2);
    expect(res.defauts?.codeScenario).toBe('MEDIAN_LEGACY');
  });
});
