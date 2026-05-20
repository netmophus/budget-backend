/**
 * Tests unitaires VersionsResumeService (Lot 7.3 + Lot 7.4).
 *
 * Mock léger du Repository<FaitBudget> + QueryBuilder fluent (pas de
 * pg-mem) : on vérifie la composition de la query + le mapping de la
 * réponse, et surtout le contrat des 3 cas de périmètre :
 *   - null      → pas de WHERE fk_centre
 *   - []        → court-circuit zéro (pas d'appel DB)
 *   - [a, b]    → AND fk_centre IN (a, b)
 *
 * Lot 7.4 — Le service lit aussi dim_version.statut via repo.manager.query.
 * Le mock retourne 'ouvert' par défaut (comportement Lot 7.3 préservé).
 * Un test dédié couvre le bypass quand statut IN (soumis/valide/gele).
 */
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';

import { FaitBudget } from '../../faits/budget/entities/fait-budget.entity';
import { VersionsResumeService } from './versions-resume.service';

interface QbMocks {
  qb: SelectQueryBuilder<FaitBudget>;
  select: jest.Mock;
  addSelect: jest.Mock;
  where: jest.Mock;
  andWhere: jest.Mock;
  getRawOne: jest.Mock;
}

function makeQb(rawOne: unknown): QbMocks {
  const select = jest.fn().mockReturnThis();
  const addSelect = jest.fn().mockReturnThis();
  const where = jest.fn().mockReturnThis();
  const andWhere = jest.fn().mockReturnThis();
  const getRawOne = jest.fn().mockResolvedValue(rawOne);
  const qb = {
    select,
    addSelect,
    where,
    andWhere,
    getRawOne,
  } as unknown as SelectQueryBuilder<FaitBudget>;
  return { qb, select, addSelect, where, andWhere, getRawOne };
}

describe('VersionsResumeService', () => {
  let service: VersionsResumeService;
  let createQueryBuilderSpy: jest.Mock;
  let managerQuerySpy: jest.Mock;

  beforeEach(async () => {
    createQueryBuilderSpy = jest.fn();
    // Lot 7.4 — par défaut, la version est 'ouvert' → comportement Lot 7.3 préservé.
    managerQuerySpy = jest.fn().mockResolvedValue([{ statut: 'ouvert' }]);
    const repoMock: Partial<Repository<FaitBudget>> = {
      createQueryBuilder: createQueryBuilderSpy as never,
      manager: { query: managerQuerySpy } as never,
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        VersionsResumeService,
        { provide: getRepositoryToken(FaitBudget), useValue: repoMock },
      ],
    }).compile();

    service = moduleRef.get(VersionsResumeService);
  });

  it('court-circuit à 0 quand crAutorises est [] (aucun CR autorisé)', async () => {
    const res = await service.getResumeVersion('42', []);

    expect(res).toEqual({
      versionId: '42',
      montantTotalFcfa: 0,
      nombreComptes: 0,
      nombreLignes: 0,
    });
    expect(createQueryBuilderSpy).not.toHaveBeenCalled();
  });

  it('admin global (crAutorises=null) : pas de filtre fk_centre', async () => {
    const mocks = makeQb({
      totalFcfa: '30000000',
      nbComptes: '5',
      nbLignes: '60',
    });
    createQueryBuilderSpy.mockReturnValue(mocks.qb);

    const res = await service.getResumeVersion('42', null);

    expect(res).toEqual({
      versionId: '42',
      montantTotalFcfa: 30_000_000,
      nombreComptes: 5,
      nombreLignes: 60,
    });
    expect(mocks.where).toHaveBeenCalledWith('fb.fk_version = :vid', {
      vid: '42',
    });
    expect(mocks.andWhere).not.toHaveBeenCalled();
  });

  it('user périmètré : ajoute AND fk_centre IN (...) avec les bons CR', async () => {
    const mocks = makeQb({
      totalFcfa: 12_500_000,
      nbComptes: 3,
      nbLignes: 24,
    });
    createQueryBuilderSpy.mockReturnValue(mocks.qb);

    const res = await service.getResumeVersion('42', ['100', '101', '102']);

    expect(res.montantTotalFcfa).toBe(12_500_000);
    expect(res.nombreComptes).toBe(3);
    expect(res.nombreLignes).toBe(24);
    expect(mocks.andWhere).toHaveBeenCalledWith('fb.fk_centre IN (:...crs)', {
      crs: ['100', '101', '102'],
    });
  });

  it('version vide (getRawOne retourne null) : renvoie 0/0/0 sans throw', async () => {
    const mocks = makeQb(undefined);
    createQueryBuilderSpy.mockReturnValue(mocks.qb);

    const res = await service.getResumeVersion('999', null);

    expect(res).toEqual({
      versionId: '999',
      montantTotalFcfa: 0,
      nombreComptes: 0,
      nombreLignes: 0,
    });
  });

  it('agrégation SQL : 1 SUM + 1 COUNT DISTINCT + 1 COUNT(*)', async () => {
    const mocks = makeQb({
      totalFcfa: 0,
      nbComptes: 0,
      nbLignes: 0,
    });
    createQueryBuilderSpy.mockReturnValue(mocks.qb);

    await service.getResumeVersion('42', null);

    expect(mocks.select).toHaveBeenCalledWith(
      'COALESCE(SUM(fb.montant_fcfa), 0)',
      'totalFcfa',
    );
    expect(mocks.addSelect).toHaveBeenNthCalledWith(
      1,
      'COUNT(DISTINCT fb.fk_compte)',
      'nbComptes',
    );
    expect(mocks.addSelect).toHaveBeenNthCalledWith(2, 'COUNT(*)', 'nbLignes');
  });

  // Lot 7.4 — bypass périmètre quand la version est verrouillée.
  describe('Lot 7.4 — bypass périmètre si version verrouillée', () => {
    it.each(['soumis', 'valide', 'gele'])(
      'statut=%s : ignore crAutorises et lit le budget complet',
      async (statut) => {
        managerQuerySpy.mockResolvedValueOnce([{ statut }]);
        const mocks = makeQb({
          totalFcfa: 19_493_000_000,
          nbComptes: 30,
          nbLignes: 1080,
        });
        createQueryBuilderSpy.mockReturnValue(mocks.qb);

        // L'appelant passe son périmètre restreint (3 CR) — il doit être ignoré.
        const res = await service.getResumeVersion('1', ['100', '101', '102']);

        expect(res.montantTotalFcfa).toBe(19_493_000_000);
        expect(res.nombreComptes).toBe(30);
        expect(res.nombreLignes).toBe(1080);
        // Pas de andWhere fk_centre : filtre périmètre bypassé.
        expect(mocks.andWhere).not.toHaveBeenCalled();
      },
    );

    it('statut=ouvert : filtre périmètre conservé (régression Lot 7.3)', async () => {
      // Le beforeEach mocke déjà 'ouvert'.
      const mocks = makeQb({
        totalFcfa: 180_000_000,
        nbComptes: 7,
        nbLignes: 96,
      });
      createQueryBuilderSpy.mockReturnValue(mocks.qb);

      await service.getResumeVersion('1', ['100', '101', '102']);

      expect(mocks.andWhere).toHaveBeenCalledWith(
        'fb.fk_centre IN (:...crs)',
        { crs: ['100', '101', '102'] },
      );
    });
  });
});
