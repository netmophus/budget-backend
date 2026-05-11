import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { AuditService } from '../../audit/audit.service';
import {
  EffectivePermission,
  PermissionsService,
} from '../permissions.service';
import { PermissionsGuard } from './permissions.guard';

function makeContext(
  reqUser: { userId: string; email: string } | undefined,
): ExecutionContext {
  const req: {
    user?: typeof reqUser;
    ip: string;
    method: string;
    url: string;
    headers: Record<string, string>;
  } = {
    user: reqUser,
    ip: '127.0.0.1',
    method: 'GET',
    url: '/api/v1/users',
    headers: { 'user-agent': 'jest' },
  };
  return {
    getHandler: () => () => undefined,
    getClass: () => Object,
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => ({}),
      getNext: () => ({}),
    }),
  } as unknown as ExecutionContext;
}

function makeGuard(opts: {
  meta?: { permissions: string[]; mode: 'any' | 'all' };
  isPublic?: boolean;
  effective: EffectivePermission[];
  prod?: boolean;
}): {
  guard: PermissionsGuard;
  permService: jest.Mocked<Pick<PermissionsService, 'getEffectivePermissions'>>;
} {
  const reflector = {
    getAllAndOverride: jest.fn().mockImplementation((key: string) => {
      if (key === 'isPublic') return opts.isPublic ?? false;
      if (key === 'requiredPermissions') return opts.meta;
      return undefined;
    }),
  } as unknown as Reflector;

  const permService = {
    getEffectivePermissions: jest.fn().mockResolvedValue(opts.effective),
  } as unknown as jest.Mocked<
    Pick<PermissionsService, 'getEffectivePermissions'>
  >;

  const config = {
    get: () => (opts.prod ? 'production' : 'development'),
  } as unknown as ConfigService;

  const auditService = {
    log: jest.fn().mockResolvedValue(undefined),
  } as unknown as AuditService;

  return {
    guard: new PermissionsGuard(
      reflector,
      permService as unknown as PermissionsService,
      config,
      auditService,
    ),
    permService,
    auditService: auditService as jest.Mocked<AuditService>,
  };
}

const eff = (code: string): EffectivePermission => ({
  code_permission: code,
  module: code.split('.')[0] ?? '',
  perimetre_type: 'global',
  perimetre_id: null,
});

describe('PermissionsGuard', () => {
  it('allows when no @RequirePermissions metadata is present', async () => {
    const { guard } = makeGuard({ meta: undefined, effective: [] });
    expect(
      await guard.canActivate(makeContext({ userId: '1', email: 'a@b.c' })),
    ).toBe(true);
  });

  it('allows on @Public() endpoints (short-circuits before reading user)', async () => {
    const { guard } = makeGuard({
      meta: undefined,
      isPublic: true,
      effective: [],
    });
    expect(await guard.canActivate(makeContext(undefined))).toBe(true);
  });

  it("mode 'any': allows when at least one required permission is held", async () => {
    const { guard } = makeGuard({
      meta: { permissions: ['USER.LIRE', 'USER.GERER'], mode: 'any' },
      effective: [eff('USER.LIRE')],
    });
    expect(
      await guard.canActivate(makeContext({ userId: '1', email: 'a@b.c' })),
    ).toBe(true);
  });

  it("mode 'any': forbids with explicit message when none held", async () => {
    const { guard } = makeGuard({
      meta: { permissions: ['USER.GERER'], mode: 'any' },
      effective: [eff('USER.LIRE')],
    });
    await expect(
      guard.canActivate(makeContext({ userId: '1', email: 'a@b.c' })),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      guard.canActivate(makeContext({ userId: '1', email: 'a@b.c' })),
    ).rejects.toThrow(/requis \[USER\.GERER\]/);
  });

  it("mode 'all': forbids if a single required permission is missing", async () => {
    const { guard } = makeGuard({
      meta: { permissions: ['USER.LIRE', 'AUDIT.LIRE'], mode: 'all' },
      effective: [eff('USER.LIRE')],
    });
    await expect(
      guard.canActivate(makeContext({ userId: '1', email: 'a@b.c' })),
    ).rejects.toThrow(ForbiddenException);
  });

  it('does not leak possessed permissions in production NODE_ENV', async () => {
    const { guard } = makeGuard({
      meta: { permissions: ['USER.GERER'], mode: 'any' },
      effective: [eff('USER.LIRE'), eff('AUDIT.LIRE')],
      prod: true,
    });
    try {
      await guard.canActivate(makeContext({ userId: '1', email: 'a@b.c' }));
      fail('expected ForbiddenException');
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain('requis [USER.GERER]');
      expect(msg).not.toContain('USER.LIRE');
      expect(msg).not.toContain('possédées');
    }
  });
});
