import {
  ArgumentsHost,
  BadRequestException,
  HttpException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import type { PinoLogger } from 'nestjs-pino';
import { AllExceptionsFilter } from './all-exceptions.filter';

interface CapturedResponse {
  status: number;
  body: Record<string, unknown>;
}

function createHost(
  url: string,
  method = 'GET',
): {
  host: ArgumentsHost;
  captured: CapturedResponse;
} {
  const captured: CapturedResponse = { status: 0, body: {} };

  const response = {
    status: (code: number) => {
      captured.status = code;
      return {
        json: (payload: Record<string, unknown>) => {
          captured.body = payload;
        },
      };
    },
  };

  const request = { url, method };

  const host = {
    switchToHttp: () => ({
      getResponse: <T>() => response as unknown as T,
      getRequest: <T>() => request as unknown as T,
      getNext: <T>() => undefined as unknown as T,
    }),
    getArgs: <T>() => [] as unknown as T,
    getArgByIndex: <T>() => undefined as unknown as T,
    switchToRpc: () =>
      ({ getContext: () => ({}), getData: () => ({}) }) as never,
    switchToWs: () => ({ getClient: () => ({}), getData: () => ({}) }) as never,
    getType: () => 'http' as never,
    getClass: () => Object as never,
    getHandler: () => (() => undefined) as never,
  } as unknown as ArgumentsHost;

  return { host, captured };
}

describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter;

  beforeEach(() => {
    const logger = {
      error: jest.fn(),
      warn: jest.fn(),
    } as unknown as PinoLogger;
    filter = new AllExceptionsFilter(logger);
  });

  it('formats a HttpException (NotFoundException) into the normalized body', () => {
    const { host, captured } = createHost('/api/v1/inexistant');

    filter.catch(new NotFoundException('Resource missing'), host);

    expect(captured.status).toBe(HttpStatus.NOT_FOUND);
    expect(captured.body).toEqual(
      expect.objectContaining({
        statusCode: HttpStatus.NOT_FOUND,
        message: 'Resource missing',
        errorCode: 'NOT_FOUND',
        path: '/api/v1/inexistant',
      }),
    );
    expect(typeof captured.body.timestamp).toBe('string');
    expect(() => new Date(captured.body.timestamp as string)).not.toThrow();
  });

  it('aggregates ValidationPipe-style array messages into a single string', () => {
    const { host, captured } = createHost('/api/v1/users', 'POST');

    const validationError = new BadRequestException({
      statusCode: 400,
      message: ['email must be an email', 'password should not be empty'],
      error: 'Bad Request',
    });

    filter.catch(validationError, host);

    expect(captured.status).toBe(HttpStatus.BAD_REQUEST);
    expect(captured.body.errorCode).toBe('VALIDATION_ERROR');
    expect(captured.body.message).toBe(
      'email must be an email; password should not be empty',
    );
  });

  it('falls back to INTERNAL_ERROR for unknown exceptions', () => {
    const { host, captured } = createHost('/api/v1/boom');

    filter.catch(new Error('boom'), host);

    expect(captured.status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(captured.body).toEqual(
      expect.objectContaining({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'boom',
        errorCode: 'INTERNAL_ERROR',
        path: '/api/v1/boom',
      }),
    );
  });

  it('handles non-Error throwables (string, object) without crashing', () => {
    const { host, captured } = createHost('/api/v1/weird');

    filter.catch('plain string thrown', host);

    expect(captured.status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(captured.body.errorCode).toBe('INTERNAL_ERROR');
    expect(captured.body.message).toBe('Internal server error');
  });

  it('uses HTTP_ERROR for non-mapped HTTP statuses', () => {
    const { host, captured } = createHost('/api/v1/teapot');

    filter.catch(new HttpException('I am a teapot', 418), host);

    expect(captured.status).toBe(418);
    expect(captured.body.errorCode).toBe('HTTP_ERROR');
    expect(captured.body.message).toBe('I am a teapot');
  });
});
