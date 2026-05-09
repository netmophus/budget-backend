import { Test, TestingModule } from '@nestjs/testing';
import type { Request } from 'express';
import { AuthController } from './auth.controller';
import { AuthService, IssuedTokens } from './auth.service';
import { LoginRateLimitGuard } from './guards/login-rate-limit.guard';
import { User } from '../users/entities/user.entity';

function makeReq(): Request {
  return {
    ip: '127.0.0.1',
    headers: { 'user-agent': 'jest' },
  } as unknown as Request;
}

const fakeTokens: IssuedTokens = {
  accessToken: 'access',
  refreshToken: '00000000-0000-4000-8000-000000000000',
  expiresIn: 900,
};

const fakeUser = {
  id: '1',
  email: 'admin@miznas.local',
  motDePasseHash: 'hash',
  nom: 'Admin',
  prenom: 'MIZNAS',
} as User;

describe('AuthController', () => {
  let controller: AuthController;
  let service: jest.Mocked<AuthService>;

  beforeEach(async () => {
    service = {
      login: jest.fn(),
      refresh: jest.fn(),
      logout: jest.fn(),
      getCurrentUser: jest.fn(),
    } as unknown as jest.Mocked<AuthService>;

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: service }],
    })
      // Lot 6.4.B : bypass du LoginRateLimitGuard appliqué sur /auth/login.
      // Le guard a ses propres tests unitaires (login-rate-limiter.service
      // .spec.ts) et e2e (rate-limit.e2e-spec.ts) — ici on teste juste la
      // délégation controller → service.
      .overrideGuard(LoginRateLimitGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = moduleRef.get(AuthController);
  });

  it('login delegates and returns tokens + user', async () => {
    service.login.mockResolvedValue({ tokens: fakeTokens, user: fakeUser });

    const result = await controller.login(
      { email: 'admin@miznas.local', motDePasse: 'ChangeMe!2026' },
      makeReq(),
    );

    expect(result).toEqual({
      ...fakeTokens,
      user: { id: '1', email: 'admin@miznas.local', nom: 'Admin', prenom: 'MIZNAS' },
    });
    expect(service.login).toHaveBeenCalledWith(
      'admin@miznas.local',
      'ChangeMe!2026',
      '127.0.0.1',
      'jest',
    );
  });

  it('refresh delegates to AuthService', async () => {
    service.refresh.mockResolvedValue(fakeTokens);
    const result = await controller.refresh(
      { refreshToken: '00000000-0000-4000-8000-000000000000' },
      makeReq(),
    );
    expect(result).toBe(fakeTokens);
  });

  it('logout delegates with email + ip + ua', async () => {
    service.logout.mockResolvedValue(undefined);
    await controller.logout(
      { refreshToken: '00000000-0000-4000-8000-000000000001' },
      { userId: '1', email: 'admin@miznas.local' },
      makeReq(),
    );
    expect(service.logout).toHaveBeenCalledWith(
      '1',
      'admin@miznas.local',
      '00000000-0000-4000-8000-000000000001',
      '127.0.0.1',
      'jest',
    );
  });

  it('me delegates to AuthService.getCurrentUser', async () => {
    const view = { id: '1', email: 'admin@miznas.local', nom: 'A', prenom: 'B', roles: [], permissions: [] };
    service.getCurrentUser.mockResolvedValue(view);
    const result = await controller.me({ userId: '1', email: 'admin@miznas.local' });
    expect(result).toBe(view);
    expect(service.getCurrentUser).toHaveBeenCalledWith('1');
  });
});
