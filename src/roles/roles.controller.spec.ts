import { Test, TestingModule } from '@nestjs/testing';
import { PermissionsController } from './permissions.controller';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';

describe('Roles + Permissions controllers (delegation only)', () => {
  let rolesController: RolesController;
  let permsController: PermissionsController;
  let rolesService: jest.Mocked<RolesService>;

  beforeEach(async () => {
    rolesService = {
      findAll: jest.fn(),
      findOne: jest.fn(),
      findAllPermissions: jest.fn(),
    } as unknown as jest.Mocked<RolesService>;

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [RolesController, PermissionsController],
      providers: [{ provide: RolesService, useValue: rolesService }],
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
});
