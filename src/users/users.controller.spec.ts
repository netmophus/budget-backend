import { Test, TestingModule } from '@nestjs/testing';
import { PermissionsService } from '../auth/permissions.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

describe('UsersController', () => {
  let controller: UsersController;
  let usersService: jest.Mocked<UsersService>;
  let permissionsService: jest.Mocked<PermissionsService>;

  beforeEach(async () => {
    usersService = {
      findAll: jest.fn(),
      findOne: jest.fn(),
    } as unknown as jest.Mocked<UsersService>;
    permissionsService = {
      getEffectivePermissions: jest.fn(),
    } as unknown as jest.Mocked<PermissionsService>;

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        { provide: UsersService, useValue: usersService },
        { provide: PermissionsService, useValue: permissionsService },
      ],
    }).compile();

    controller = moduleRef.get(UsersController);
  });

  it('findAll delegates with full pagination DTO', async () => {
    const dto = { items: [], total: 0, page: 1, limit: 20 };
    usersService.findAll.mockResolvedValue(dto);
    const result = await controller.findAll({ page: 1, limit: 20 });
    expect(result).toBe(dto);
    expect(usersService.findAll).toHaveBeenCalledWith({ page: 1, limit: 20 });
  });

  it('findOne delegates by id', async () => {
    const detail = {
      id: '1',
      email: 'a@b.c',
      nom: 'A',
      prenom: 'B',
      estActif: true,
      dateDerniereConnexion: null,
      dateCreation: new Date(),
      roles: [],
      permissions: [],
    };
    usersService.findOne.mockResolvedValue(detail);
    expect(await controller.findOne('1')).toBe(detail);
  });

  it('me/permissions delegates to PermissionsService', async () => {
    permissionsService.getEffectivePermissions.mockResolvedValue([]);
    await controller.meEffectivePermissions({ userId: '1', email: 'a@b.c' });
    expect(permissionsService.getEffectivePermissions).toHaveBeenCalledWith(
      '1',
    );
  });
});
