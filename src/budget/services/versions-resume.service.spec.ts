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

interface QbCalls {
  where: Array<{ clause: string; params?: Record<string, unknown> }>;
  andWhere: Array<{ clause: string; params?: Record<string, unknown> }>;
  selects: string[];
  rawOne: unknown;
}

function makeQb(rawOne: unknown): {
  qb: Partial<SelectQueryBuilder<FaitBudget>>;
  calls: QbCalls;
} {
  const calls: QbCalls = {
    where: [],
    andWhere: [],
    selects: [],
    rawOne,
  };
  const qb: Partial<SelectQueryBuilder<FaitBudget>> = {
    select(s: string, _alias?: string) {
      calls.selects.push(s);
      return qb as SelectQueryBuilder<FaitBudget>;
    },
    addSelect(s: string, _alias?: string) {
      calls.selects.push(s);
      return qb as SelectQueryBuilder<FaitBudget>;
    },
    where(clause: string, params?: Record<string, unknown>) {
      calls.where.push({ clause, params });
      return qb as SelectQueryBuilder<FaitBudget>;
    },
    andWhere(clause: string, params?: Record<string, unknown>) {
      calls.andWhere.push({ clause, params });
      return qb as SelectQueryBuilder<FaitBudget>;
    },
    async getRawOne<T>() {
      return rawOne as T;
    },
  };
  return { qb, calls };
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
    const { qb, calls } = makeQb({
      totalFcfa: '30000000',
      nbComptes: '5',
      nbLignes: '60',
    });
    createQueryBuilderSpy.mockReturnValue(qb);

    const res = await service.getResumeVersion('42', null);

    expect(res).toEqual({
      versionId: '42',
      montantTotalFcfa: 30_000_000,
      nombreComptes: 5,
      nombreLignes: 60,
    });
    expect(calls.where).toEqual([
      { clause: 'fb.fk_version = :vid', params: { vid: '42' } },
    ]);
    expect(calls.andWhere).toEqual([]);
  });

  it('user périmètré : ajoute AND fk_centre IN (...) avec les bons CR', async () => {
    const { qb, calls } = makeQb({
      totalFcfa: 12_500_000,
      nbComptes: 3,
      nbLignes: 24,
    });
    createQueryBuilderSpy.mockReturnValue(qb);

    const res = await service.getResumeVersion('42', ['100', '101', '102']);

    expect(res.montantTotalFcfa).toBe(12_500_000);
    expect(res.nombreComptes).toBe(3);
    expect(res.nombreLignes).toBe(24);
    expect(calls.andWhere).toEqual([
      {
        clause: 'fb.fk_centre IN (:...crs)',
        params: { crs: ['100', '101', '102'] },
      },
    ]);
  });

  it('version vide (getRawOne retourne null) : renvoie 0/0/0 sans throw', async () => {
    const { qb } = makeQb(undefined);
    createQueryBuilderSpy.mockReturnValue(qb);

    const res = await service.getResumeVersion('999', null);

    expect(res).toEqual({
      versionId: '999',
      montantTotalFcfa: 0,
      nombreComptes: 0,
      nombreLignes: 0,
    });
  });

  it('agrégation SQL : 1 SUM + 1 COUNT DISTINCT + 1 COUNT(*)', async () => {
    const { qb, calls } = makeQb({
      totalFcfa: 0,
      nbComptes: 0,
      nbLignes: 0,
    });
    createQueryBuilderSpy.mockReturnValue(qb);

    await service.getResumeVersion('42', null);

    expect(calls.selects).toEqual([
      'COALESCE(SUM(fb.montant_fcfa), 0)',
      'COUNT(DISTINCT fb.fk_compte)',
      'COUNT(*)',
    ]);
  });
});
