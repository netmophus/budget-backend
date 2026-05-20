/**
 * Tests unitaires VersionsResumeService (Lot 7.3).
 *
 * Mock léger du Repository<FaitBudget> + QueryBuilder fluent (pas de
 * pg-mem) : on vérifie la composition de la query + le mapping de la
 * réponse, et surtout le contrat des 3 cas de périmètre :
 *   - null      → pas de WHERE fk_centre
 *   - []        → court-circuit zéro (pas d'appel DB)
 *   - [a, b]    → AND fk_centre IN (a, b)
 */
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';

import { FaitBudget } from '../../faits/budget/entities/fait-budget.entity';
import { VersionsResumeService } from './versions-resume.service';

/**
 * Mock QueryBuilder typé via `as unknown as SelectQueryBuilder` —
 * `jest.fn().mockReturnThis()` court-circuite les surcharges multiples
 * de `select`/`addSelect` (string | callback | string[]) qu'on ne peut
 * pas matcher proprement avec un Partial.
 */
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

  beforeEach(async () => {
    createQueryBuilderSpy = jest.fn();
    const repoMock: Partial<Repository<FaitBudget>> = {
      createQueryBuilder: createQueryBuilderSpy as never,
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
});
