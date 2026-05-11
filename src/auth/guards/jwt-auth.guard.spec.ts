import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard';

function makeContext(): ExecutionContext {
  return {
    getHandler: () => () => undefined,
    getClass: () => Object,
  } as unknown as ExecutionContext;
}

describe('JwtAuthGuard', () => {
  it('returns true (bypass) when @Public() metadata is present', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(true),
    } as unknown as Reflector;
    const guard = new JwtAuthGuard(reflector);
    expect(guard.canActivate(makeContext())).toBe(true);
  });

  it('reads metadata via Reflector with both handler and class scopes', () => {
    const getter = jest.fn().mockReturnValue(true);
    const reflector = { getAllAndOverride: getter } as unknown as Reflector;
    const guard = new JwtAuthGuard(reflector);
    void guard.canActivate(makeContext());
    expect(getter).toHaveBeenCalledWith(
      'isPublic',
      expect.arrayContaining([expect.any(Function)]),
    );
  });
});
