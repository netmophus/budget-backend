import { CallHandler, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { firstValueFrom, of, throwError } from 'rxjs';
import { AuditService } from '../audit.service';
import {
  AUDITABLE_KEY,
  AuditableMetadata,
} from '../decorators/auditable.decorator';
import { AuditInterceptor } from './audit.interceptor';

function makeContext(
  body: unknown,
  user?: { email: string },
): ExecutionContext {
  return {
    getHandler: () => () => undefined,
    getClass: () => Object,
    switchToHttp: () => ({
      getRequest: () => ({
        body,
        user,
        ip: '127.0.0.1',
        headers: { 'user-agent': 'jest' },
      }),
      getResponse: () => ({}),
      getNext: () => ({}),
    }),
  } as unknown as ExecutionContext;
}

function makeReflector(meta: AuditableMetadata | undefined): Reflector {
  return {
    getAllAndOverride: jest
      .fn()
      .mockImplementation((k: string) =>
        k === AUDITABLE_KEY ? meta : undefined,
      ),
  } as unknown as Reflector;
}

describe('AuditInterceptor', () => {
  let auditService: jest.Mocked<AuditService>;

  beforeEach(() => {
    auditService = {
      log: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<AuditService>;
  });

  it('does nothing when @Auditable is absent', async () => {
    const interceptor = new AuditInterceptor(
      makeReflector(undefined),
      auditService,
    );
    const handler: CallHandler = { handle: () => of({ ok: true }) };

    const result = await firstValueFrom(
      interceptor.intercept(makeContext({ a: 1 }), handler),
    );
    expect(result).toEqual({ ok: true });
    expect(auditService.log).not.toHaveBeenCalled();
  });

  it('logs success with sanitized payload', async () => {
    const meta: AuditableMetadata = {
      typeAction: 'CREATE',
      entiteCible: 'user',
    };
    const interceptor = new AuditInterceptor(makeReflector(meta), auditService);
    const handler: CallHandler = {
      handle: () => of({ id: '1', email: 'a@b.c' }),
    };
    const body = { email: 'a@b.c', motDePasse: 'secret' };

    const result = await firstValueFrom(
      interceptor.intercept(
        makeContext(body, { email: 'admin@miznas.local' }),
        handler,
      ),
    );

    expect(result).toEqual({ id: '1', email: 'a@b.c' });
    expect(auditService.log).toHaveBeenCalledTimes(1);
    const call = auditService.log.mock.calls[0][0];
    expect(call.statut).toBe('success');
    expect(call.utilisateur).toBe('admin@miznas.local');
    const payload = call.payloadApres as { body: { motDePasse: unknown } };
    expect(payload.body.motDePasse).toBe('***REDACTED***');
  });

  it('logs failure and re-throws when handler errors', async () => {
    const meta: AuditableMetadata = {
      typeAction: 'UPDATE',
      entiteCible: 'user',
    };
    const interceptor = new AuditInterceptor(makeReflector(meta), auditService);
    const err = new Error('boom');
    const handler: CallHandler = { handle: () => throwError(() => err) };

    await expect(
      firstValueFrom(
        interceptor.intercept(
          makeContext({}, { email: 'admin@miznas.local' }),
          handler,
        ),
      ),
    ).rejects.toThrow('boom');
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ statut: 'failure', commentaire: 'boom' }),
    );
  });

  it('uses extractIdCible to enrich the audit row', async () => {
    const extractIdCible = jest.fn().mockReturnValue('42');
    const meta: AuditableMetadata = {
      typeAction: 'UPDATE',
      entiteCible: 'user',
      extractIdCible,
    };
    const interceptor = new AuditInterceptor(makeReflector(meta), auditService);
    const handler: CallHandler = { handle: () => of({ ok: true }) };
    await firstValueFrom(
      interceptor.intercept(makeContext({}, { email: 'a@b.c' }), handler),
    );
    expect(extractIdCible).toHaveBeenCalled();
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ idCible: '42' }),
    );
  });
});
