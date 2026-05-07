import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/entities/user-role.entity';
import { PermissionsService } from './permissions.service';

interface QbStub {
  innerJoinAndSelect: jest.Mock;
  leftJoinAndSelect: jest.Mock;
  where: jest.Mock;
  andWhere: jest.Mock;
  getMany: jest.Mock;
}

function makeQb(rows: Partial<UserRole>[]): QbStub {
  const qb: QbStub = {
    innerJoinAndSelect: jest.fn().mockReturnThis(),
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue(rows),
  };
  return qb;
}

function urRow(opts: {
  perimetreType?: string | null;
  perimetreId?: string | null;
  permissions: Array<{ code: string; module: string }>;
}): Partial<UserRole> {
  return {
    perimetreType: opts.perimetreType ?? null,
    perimetreId: opts.perimetreId ?? null,
    role: {
      rolePermissions: opts.permissions.map((p) => ({
        permission: { codePermission: p.code, module: p.module },
      })),
    },
  } as unknown as UserRole;
}

describe('PermissionsService', () => {
  let service: PermissionsService;
  let userRepo: jest.Mocked<Pick<Repository<User>, 'findOne'>>;
  let userRoleRepo: {
    createQueryBuilder: jest.Mock;
    manager: { query: jest.Mock };
  };

  beforeEach(async () => {
    userRepo = { findOne: jest.fn() };
    userRoleRepo = {
      createQueryBuilder: jest.fn(),
      manager: { query: jest.fn().mockResolvedValue([]) },
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        PermissionsService,
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: getRepositoryToken(UserRole), useValue: userRoleRepo },
      ],
    }).compile();

    service = moduleRef.get(PermissionsService);
  });

  it('returns [] for an inactive user', async () => {
    userRepo.findOne.mockResolvedValue({ id: '1', estActif: false } as User);
    expect(await service.getEffectivePermissions('1')).toEqual([]);
    expect(userRoleRepo.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('returns [] for an unknown user', async () => {
    userRepo.findOne.mockResolvedValue(null);
    expect(await service.getEffectivePermissions('999')).toEqual([]);
  });

  it('flattens permissions from a single global role (perimetre_type null → global)', async () => {
    userRepo.findOne.mockResolvedValue({ id: '1', estActif: true } as User);
    userRoleRepo.createQueryBuilder.mockReturnValue(
      makeQb([
        urRow({
          perimetreType: 'global',
          permissions: [
            { code: 'USER.LIRE', module: 'USER' },
            { code: 'ROLE.LIRE', module: 'ROLE' },
          ],
        }),
      ]),
    );

    const result = await service.getEffectivePermissions('1');
    expect(result).toEqual([
      {
        code_permission: 'USER.LIRE',
        module: 'USER',
        perimetre_type: 'global',
        perimetre_id: null,
      },
      {
        code_permission: 'ROLE.LIRE',
        module: 'ROLE',
        perimetre_type: 'global',
        perimetre_id: null,
      },
    ]);
  });

  it('multiplies permissions across roles on different periphery scopes', async () => {
    userRepo.findOne.mockResolvedValue({ id: '1', estActif: true } as User);
    userRoleRepo.createQueryBuilder.mockReturnValue(
      makeQb([
        urRow({
          perimetreType: 'structure',
          perimetreId: '10',
          permissions: [{ code: 'BUDGET.SAISIR', module: 'BUDGET' }],
        }),
        urRow({
          perimetreType: 'centre_responsabilite',
          perimetreId: '42',
          permissions: [{ code: 'BUDGET.SAISIR', module: 'BUDGET' }],
        }),
      ]),
    );

    const result = await service.getEffectivePermissions('1');
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      perimetre_type: 'structure',
      perimetre_id: '10',
    });
    expect(result[1]).toMatchObject({
      perimetre_type: 'centre_responsabilite',
      perimetre_id: '42',
    });
  });

  describe('hasPermission', () => {
    beforeEach(() => {
      userRepo.findOne.mockResolvedValue({ id: '1', estActif: true } as User);
      userRoleRepo.createQueryBuilder.mockReturnValue(
        makeQb([
          urRow({
            permissions: [
              { code: 'USER.LIRE', module: 'USER' },
              { code: 'ROLE.LIRE', module: 'ROLE' },
            ],
          }),
        ]),
      );
    });

    it("mode 'any': returns true if at least one matches", async () => {
      expect(
        await service.hasPermission('1', ['USER.LIRE', 'USER.GERER'], 'any'),
      ).toBe(true);
    });

    it("mode 'any': returns false if none match", async () => {
      expect(await service.hasPermission('1', ['USER.GERER'], 'any')).toBe(false);
    });

    it("mode 'all': returns true only if every code is possessed", async () => {
      expect(
        await service.hasPermission('1', ['USER.LIRE', 'ROLE.LIRE'], 'all'),
      ).toBe(true);
      expect(
        await service.hasPermission('1', ['USER.LIRE', 'USER.GERER'], 'all'),
      ).toBe(false);
    });
  });

  // Lot 4.2 — permissions natives + déléguées avec contexte
  describe('getPermissionsEffectivesAvecContexte', () => {
    beforeEach(() => {
      userRepo.findOne.mockResolvedValue({ id: '1', estActif: true } as User);
      userRoleRepo.createQueryBuilder.mockReturnValue(
        makeQb([
          urRow({
            perimetreType: 'global',
            permissions: [{ code: 'USER.LIRE', module: 'USER' }],
          }),
        ]),
      );
    });

    it('marque les permissions natives via=NATIF', async () => {
      const result = await service.getPermissionsEffectivesAvecContexte('1');
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        code_permission: 'USER.LIRE',
        via: 'NATIF',
      });
      expect(result[0]!.delegation_id).toBeUndefined();
    });

    it('ajoute les permissions reçues par délégation avec via=DELEGATION et delegation_id', async () => {
      userRoleRepo.manager.query.mockResolvedValue([
        { id: '99', permissions: ['VALIDATION', 'SAISIE'] },
      ]);
      const result = await service.getPermissionsEffectivesAvecContexte(
        '1',
        '2027-01-15',
      );
      // 1 native + 2 déléguées (VALIDATION → BUDGET.VALIDER, SAISIE → BUDGET.SAISIR)
      expect(result).toHaveLength(3);
      const deleguees = result.filter((r) => r.via === 'DELEGATION');
      expect(deleguees).toHaveLength(2);
      expect(deleguees.map((d) => d.code_permission).sort()).toEqual([
        'BUDGET.SAISIR',
        'BUDGET.VALIDER',
      ]);
      expect(deleguees.every((d) => d.delegation_id === '99')).toBe(true);
    });

    it("interroge la table delegations avec dateRef quand fourni", async () => {
      await service.getPermissionsEffectivesAvecContexte('1', '2027-06-15');
      expect(userRoleRepo.manager.query).toHaveBeenCalledWith(
        expect.stringContaining('FROM delegations'),
        ['1', '2027-06-15'],
      );
    });

    it('utilise CURRENT_DATE par défaut si dateRef absent', async () => {
      const today = new Date().toISOString().slice(0, 10);
      await service.getPermissionsEffectivesAvecContexte('1');
      expect(userRoleRepo.manager.query).toHaveBeenCalledWith(
        expect.any(String),
        ['1', today],
      );
    });

    it('ignore les verbes inconnus dans le mapping', async () => {
      userRoleRepo.manager.query.mockResolvedValue([
        { id: '7', permissions: ['SAISIE', 'INCONNU'] },
      ]);
      const result = await service.getPermissionsEffectivesAvecContexte('1');
      const deleguees = result.filter((r) => r.via === 'DELEGATION');
      expect(deleguees).toHaveLength(1);
      expect(deleguees[0]!.code_permission).toBe('BUDGET.SAISIR');
    });
  });

  // Lot 4.2-fix.A — helper pour audit applicatif via_delegation_id
  describe('getDelegationContextPour', () => {
    beforeEach(() => {
      userRepo.findOne.mockResolvedValue({ id: '1', estActif: true } as User);
    });

    it('retourne delegation_id si la permission vient uniquement d\'une délégation', async () => {
      // Pas de natifs ; 1 délégation portant SAISIE → BUDGET.SAISIR
      userRoleRepo.createQueryBuilder.mockReturnValue(makeQb([]));
      userRoleRepo.manager.query.mockResolvedValue([
        { id: '42', permissions: ['SAISIE'] },
      ]);
      expect(
        await service.getDelegationContextPour('1', 'BUDGET.SAISIR'),
      ).toBe('42');
    });

    it('retourne null si la permission est native', async () => {
      userRoleRepo.createQueryBuilder.mockReturnValue(
        makeQb([
          urRow({
            permissions: [{ code: 'BUDGET.VALIDER', module: 'BUDGET' }],
          }),
        ]),
      );
      userRoleRepo.manager.query.mockResolvedValue([]);
      expect(
        await service.getDelegationContextPour('1', 'BUDGET.VALIDER'),
      ).toBeNull();
    });

    it('priorité NATIF : retourne null si la permission est à la fois native ET déléguée', async () => {
      // Natif BUDGET.VALIDER + délégation portant aussi VALIDATION
      userRoleRepo.createQueryBuilder.mockReturnValue(
        makeQb([
          urRow({
            permissions: [{ code: 'BUDGET.VALIDER', module: 'BUDGET' }],
          }),
        ]),
      );
      userRoleRepo.manager.query.mockResolvedValue([
        { id: '99', permissions: ['VALIDATION'] },
      ]);
      expect(
        await service.getDelegationContextPour('1', 'BUDGET.VALIDER'),
      ).toBeNull();
    });

    it('retourne null si la permission n\'est ni native ni déléguée', async () => {
      userRoleRepo.createQueryBuilder.mockReturnValue(makeQb([]));
      userRoleRepo.manager.query.mockResolvedValue([]);
      expect(
        await service.getDelegationContextPour('1', 'BUDGET.PUBLIER'),
      ).toBeNull();
    });
  });
});
