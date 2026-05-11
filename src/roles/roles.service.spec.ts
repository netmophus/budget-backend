import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Permission } from './entities/permission.entity';
import { Role } from './entities/role.entity';
import { RolesService } from './roles.service';

function makeRole(overrides: Partial<Role> = {}): Role {
  return {
    id: '1',
    codeRole: 'ADMIN',
    libelle: 'Administrateur système',
    description: 'desc',
    estActif: true,
    rolePermissions: [
      {
        permission: {
          id: '10',
          codePermission: 'USER.LIRE',
          libelle: 'Lire les utilisateurs',
          module: 'USER',
          description: null,
        },
      },
      {
        permission: {
          id: '11',
          codePermission: 'AUDIT.LIRE',
          libelle: 'Consulter le journal d’audit',
          module: 'AUDIT',
          description: null,
        },
      },
    ],
    ...overrides,
  } as unknown as Role;
}

describe('RolesService', () => {
  let service: RolesService;
  let roleRepo: jest.Mocked<Pick<Repository<Role>, 'find' | 'findOne'>>;
  let permRepo: jest.Mocked<Pick<Repository<Permission>, 'find'>>;

  beforeEach(async () => {
    roleRepo = { find: jest.fn(), findOne: jest.fn() };
    permRepo = { find: jest.fn() };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        RolesService,
        { provide: getRepositoryToken(Role), useValue: roleRepo },
        { provide: getRepositoryToken(Permission), useValue: permRepo },
      ],
    }).compile();

    service = moduleRef.get(RolesService);
  });

  it('findAll returns roles with their permissions flattened', async () => {
    roleRepo.find.mockResolvedValue([makeRole()]);
    const result = await service.findAll();
    expect(result).toHaveLength(1);
    expect(result[0].codeRole).toBe('ADMIN');
    expect(result[0].permissions).toHaveLength(2);
    expect(result[0].permissions[0]).toMatchObject({
      codePermission: 'USER.LIRE',
    });
  });

  it('findOne throws NotFound when missing', async () => {
    roleRepo.findOne.mockResolvedValue(null);
    await expect(service.findOne('99')).rejects.toThrow(NotFoundException);
  });

  it('findOne returns mapped DTO when found', async () => {
    roleRepo.findOne.mockResolvedValue(makeRole());
    const result = await service.findOne('1');
    expect(result.codeRole).toBe('ADMIN');
    expect(result.permissions).toHaveLength(2);
  });

  it('findAllPermissions returns mapped permissions sorted by module/code', async () => {
    permRepo.find.mockResolvedValue([
      {
        id: '1',
        codePermission: 'USER.LIRE',
        libelle: 'Lire',
        module: 'USER',
        description: null,
      } as Permission,
      {
        id: '2',
        codePermission: 'AUDIT.LIRE',
        libelle: 'Lire audit',
        module: 'AUDIT',
        description: null,
      } as Permission,
    ]);
    const result = await service.findAllPermissions();
    expect(result).toHaveLength(2);
    expect(permRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        order: expect.objectContaining({ module: 'ASC' }),
      }),
    );
  });
});
