import { Test, TestingModule } from '@nestjs/testing';
import type { AuthUser } from '../auth/decorators/current-user.decorator';
import { PermissionsController } from './permissions.controller';
import { RolePermissionService } from './role-permission.service';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';

describe('Roles + Permissions controllers (delegation only)', () => {
  let rolesController: RolesController;
  let permsController: PermissionsController;
  let rolesService: jest.Mocked<RolesService>;
  let rolePermissionService: jest.Mocked<RolePermissionService>;

  const caller: AuthUser = { userId: '7', email: 'admin@test.local' };

  beforeEach(async () => {
    rolesService = {
      findAll: jest.fn(),
      findOne: jest.fn(),
      findAllPermissions: jest.fn(),
    } as unknown as jest.Mocked<RolesService>;
    rolePermissionService = {
      ajouterPermission: jest.fn(),
      retirerPermission: jest.fn(),
    } as unknown as jest.Mocked<RolePermissionService>;

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [RolesController, PermissionsController],
      providers: [
        { provide: RolesService, useValue: rolesService },
        { provide: RolePermissionService, useValue: rolePermissionService },
      ],
    }).compile();

    rolesController = moduleRef.get(RolesController);
    permsController = moduleRef.get(PermissionsController);
  });

  it('GET /roles delegates', async () => {
    rolesService.findAll.mockResolvedValue([]);
    expect(await rolesController.findAll()).toEqual([]);
  });

  it('GET /roles/:id delegates', async () => {
    const role = {
      id: '1',
      codeRole: 'ADMIN',
      libelle: '',
      description: null,
      estActif: true,
      permissions: [],
    };
    rolesService.findOne.mockResolvedValue(role);
    expect(await rolesController.findOne('1')).toBe(role);
  });

  it('GET /permissions delegates', async () => {
    rolesService.findAllPermissions.mockResolvedValue([]);
    expect(await permsController.findAll()).toEqual([]);
  });

  it('POST /roles/:id/permissions delegates to ajouterPermission', async () => {
    const res = {
      roleId: '3',
      codeRole: 'SAISISSEUR',
      fkPermission: '12',
      codePermission: 'BUDGET.LIRE',
      deja: false,
    };
    rolePermissionService.ajouterPermission.mockResolvedValue(res);
    expect(
      await rolesController.ajouterPermission(
        '3',
        { fkPermission: '12', motif: 'test' },
        caller,
      ),
    ).toBe(res);
    expect(rolePermissionService.ajouterPermission).toHaveBeenCalledWith(
      '3',
      '12',
      caller,
      'test',
    );
  });

  it('DELETE /roles/:id/permissions/:permId delegates to retirerPermission', async () => {
    const res = {
      roleId: '3',
      codeRole: 'SAISISSEUR',
      fkPermission: '12',
      codePermission: 'BUDGET.LIRE',
      deja: false,
    };
    rolePermissionService.retirerPermission.mockResolvedValue(res);
    expect(await rolesController.retirerPermission('3', '12', {}, caller)).toBe(
      res,
    );
    expect(rolePermissionService.retirerPermission).toHaveBeenCalledWith(
      '3',
      '12',
      caller,
      undefined,
    );
  });
});
