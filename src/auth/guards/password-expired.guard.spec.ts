/**
 * Tests unitaires PasswordExpiredGuard (Lot 6.4.A).
 *
 * Le guard bloque les routes authentifiées si le JWT contient les
 * flags mdpExpire ou doitChangerMdp, sauf si la route porte
 * @AllowExpiredPassword() ou @Public().
 */
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { ALLOW_EXPIRED_PASSWORD_KEY } from '../decorators/allow-expired-password.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { PasswordExpiredGuard } from './password-expired.guard';
import type { AuthUser } from '../decorators/current-user.decorator';

function makeContext(user: Partial<AuthUser> | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: (): { user?: Partial<AuthUser> } => ({ user }),
    }),
    getHandler: () => () => {},
    getClass: () => class {},
  } as unknown as ExecutionContext;
}

function makeReflectorWith(
  publicValue: boolean | undefined,
  allowExpiredValue: boolean | undefined,
): Reflector {
  return {
    getAllAndOverride: jest.fn((key: string) => {
      if (key === IS_PUBLIC_KEY) return publicValue;
      if (key === ALLOW_EXPIRED_PASSWORD_KEY) return allowExpiredValue;
      return undefined;
    }),
  } as unknown as Reflector;
}

describe('PasswordExpiredGuard', () => {
  it('laisse passer une route @Public() sans regarder les flags JWT', () => {
    const guard = new PasswordExpiredGuard(makeReflectorWith(true, undefined));
    expect(
      guard.canActivate(
        makeContext({ userId: '1', email: 'a@b.c', mdpExpire: true, doitChangerMdp: true }),
      ),
    ).toBe(true);
  });

  it('laisse passer une route @AllowExpiredPassword() même avec doitChangerMdp', () => {
    const guard = new PasswordExpiredGuard(
      makeReflectorWith(undefined, true),
    );
    expect(
      guard.canActivate(
        makeContext({ userId: '1', email: 'a@b.c', doitChangerMdp: true }),
      ),
    ).toBe(true);
  });

  it('laisse passer un user sans flags (login normal)', () => {
    const guard = new PasswordExpiredGuard(
      makeReflectorWith(undefined, undefined),
    );
    expect(
      guard.canActivate(
        makeContext({ userId: '1', email: 'a@b.c', mdpExpire: false, doitChangerMdp: false }),
      ),
    ).toBe(true);
  });

  it('bloque avec ForbiddenException MDP_TEMPORAIRE si doitChangerMdp=true', () => {
    const guard = new PasswordExpiredGuard(
      makeReflectorWith(undefined, undefined),
    );
    try {
      guard.canActivate(
        makeContext({ userId: '1', email: 'a@b.c', doitChangerMdp: true }),
      );
      throw new Error('Should have thrown ForbiddenException');
    } catch (err) {
      expect(err).toBeInstanceOf(ForbiddenException);
      const response = (err as ForbiddenException).getResponse() as {
        code: string;
      };
      expect(response.code).toBe('MDP_TEMPORAIRE');
    }
  });

  it('bloque avec ForbiddenException MDP_EXPIRE si mdpExpire=true (et pas doitChangerMdp)', () => {
    const guard = new PasswordExpiredGuard(
      makeReflectorWith(undefined, undefined),
    );
    try {
      guard.canActivate(
        makeContext({ userId: '1', email: 'a@b.c', mdpExpire: true }),
      );
      throw new Error('Should have thrown ForbiddenException');
    } catch (err) {
      expect(err).toBeInstanceOf(ForbiddenException);
      const response = (err as ForbiddenException).getResponse() as {
        code: string;
      };
      expect(response.code).toBe('MDP_EXPIRE');
    }
  });

  it("doitChangerMdp prime sur mdpExpire (cas user dans les 2 états)", () => {
    const guard = new PasswordExpiredGuard(
      makeReflectorWith(undefined, undefined),
    );
    try {
      guard.canActivate(
        makeContext({
          userId: '1',
          email: 'a@b.c',
          mdpExpire: true,
          doitChangerMdp: true,
        }),
      );
      throw new Error('Should have thrown');
    } catch (err) {
      const response = (err as ForbiddenException).getResponse() as {
        code: string;
      };
      // doitChangerMdp est checké en premier dans le guard.
      expect(response.code).toBe('MDP_TEMPORAIRE');
    }
  });
});
