import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PermissionsService } from '../auth/permissions.service';
import { User } from './entities/user.entity';
import { UserRole } from './entities/user-role.entity';
import { UsersService } from './users.service';

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: '1',
    email: 'admin@miznas.local',
    motDePasseHash: 'secret-must-not-leak',
    nom: 'Admin',
    prenom: 'MIZNAS',
    estActif: true,
    dateDerniereConnexion: null,
    dateCreation: new Date('2026-04-01T00:00:00Z'),
    utilisateurCreation: 'system',
    dateModification: null,
    utilisateurModification: null,
    ...overrides,
  } as User;
}

describe('UsersService', () => {
  let service: UsersService;
  let userRepo: jest.Mocked<Pick<Repository<User>, 'findOne' | 'findAndCount'>>;
  let userRoleRepo: jest.Mocked<Pick<Repository<UserRole>, 'find'>>;
  let permissionsService: jest.Mocked<Pick<PermissionsService, 'getEffectivePermissions'>>;

  beforeEach(async () => {
    userRepo = { findOne: jest.fn(), findAndCount: jest.fn() };
    userRoleRepo = { find: jest.fn() };
    permissionsService = { getEffectivePermissions: jest.fn() };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: getRepositoryToken(UserRole), useValue: userRoleRepo },
        { provide: PermissionsService, useValue: permissionsService },
      ],
    }).compile();

    service = moduleRef.get(UsersService);
  });

  describe('findAll', () => {
    it('paginates with defaults and never returns motDePasseHash', async () => {
      userRepo.findAndCount.mockResolvedValue([[makeUser()], 1]);

      const result = await service.findAll({ page: 1, limit: 20 });

      expect(result).toMatchObject({ total: 1, page: 1, limit: 20 });
      expect(result.items[0]).toEqual({
        id: '1',
        email: 'admin@miznas.local',
        nom: 'Admin',
        prenom: 'MIZNAS',
        estActif: true,
        dateDerniereConnexion: null,
        dateCreation: expect.any(Date),
      });
      // Critical: hash must not appear anywhere in the response.
      expect(JSON.stringify(result)).not.toContain('secret-must-not-leak');
      expect(JSON.stringify(result)).not.toContain('motDePasseHash');
    });

    it('applies skip/take from page+limit and forwards filters', async () => {
      userRepo.findAndCount.mockResolvedValue([[], 0]);
      await service.findAll({ page: 3, limit: 10, email: 'admin', estActif: true });
      const callArg = userRepo.findAndCount.mock.calls[0][0]!;
      expect(callArg.skip).toBe(20);
      expect(callArg.take).toBe(10);
      expect(callArg.where).toMatchObject({ estActif: true });
    });
  });

  describe('findOne', () => {
    it('throws NotFound when missing', async () => {
      userRepo.findOne.mockResolvedValue(null);
      await expect(service.findOne('99')).rejects.toThrow(NotFoundException);
    });

    it('enriches with roles and permissions, never leaks the hash', async () => {
      userRepo.findOne.mockResolvedValue(makeUser());
      userRoleRepo.find.mockResolvedValue([
        {
          perimetreType: 'global',
          perimetreId: null,
          role: { codeRole: 'ADMIN', libelle: 'Administrateur système' },
        } as unknown as UserRole,
      ]);
      permissionsService.getEffectivePermissions.mockResolvedValue([
        {
          code_permission: 'USER.LIRE',
          module: 'USER',
          perimetre_type: 'global',
          perimetre_id: null,
        },
      ]);

      const result = await service.findOne('1');
      expect(result.roles).toEqual([
        {
          code: 'ADMIN',
          libelle: 'Administrateur système',
          perimetreType: 'global',
          perimetreId: null,
        },
      ]);
      expect(result.permissions).toHaveLength(1);
      expect(JSON.stringify(result)).not.toContain('secret-must-not-leak');
    });
  });
});
