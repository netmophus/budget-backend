import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

interface NormalizedErrorBody {
  statusCode: number;
  message: string;
  errorCode: string;
  timestamp: string;
  path: string;
}

interface HttpExceptionResponseShape {
  message?: string | string[];
  error?: string;
  statusCode?: number;
  /**
   * Lot 6.4.A — code applicatif optionnel posé par certaines
   * exceptions pour permettre au frontend de distinguer plusieurs
   * sémantiques au sein d'un même code HTTP (ex: 403 MDP_TEMPORAIRE
   * vs 403 MDP_EXPIRE vs 403 RBAC standard). Si présent, il
   * remplace le code dérivé du status HTTP dans `errorCode`.
   */
  code?: string;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(
    @InjectPinoLogger(AllExceptionsFilter.name)
    private readonly logger: PinoLogger,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const { statusCode, message, errorCode } = this.resolveError(exception);

    const body: NormalizedErrorBody = {
      statusCode,
      message,
      errorCode,
      timestamp: new Date().toISOString(),
      path: request.url,
    };

    if (statusCode >= 500) {
      this.logger.error(
        {
          method: request.method,
          url: request.url,
          statusCode,
          errorCode,
          err: exception instanceof Error ? exception : undefined,
        },
        message,
      );
    } else {
      this.logger.warn(
        {
          method: request.method,
          url: request.url,
          statusCode,
          errorCode,
        },
        message,
      );
    }

    response.status(statusCode).json(body);
  }

  private resolveError(exception: unknown): {
    statusCode: number;
    message: string;
    errorCode: string;
  } {
    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      let message: string;
      let codeApplicatif: string | undefined;
      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else {
        const shape = exceptionResponse as HttpExceptionResponseShape;
        if (Array.isArray(shape.message)) {
          message = shape.message.join('; ');
        } else if (typeof shape.message === 'string') {
          message = shape.message;
        } else {
          message = exception.message;
        }
        codeApplicatif = shape.code;
      }

      return {
        statusCode,
        message,
        // Lot 6.4.A — un `code` applicatif posé par l'exception prime
        // sur le mapping HTTP générique (cf. PasswordExpiredGuard
        // qui distingue MDP_TEMPORAIRE de MDP_EXPIRE).
        errorCode: codeApplicatif ?? this.errorCodeForHttpStatus(statusCode),
      };
    }

    const message =
      exception instanceof Error ? exception.message : 'Internal server error';

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message,
      errorCode: 'INTERNAL_ERROR',
    };
  }

  private errorCodeForHttpStatus(status: number): string {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return 'VALIDATION_ERROR';
      case HttpStatus.UNAUTHORIZED:
        return 'UNAUTHORIZED';
      case HttpStatus.FORBIDDEN:
        return 'FORBIDDEN';
      case HttpStatus.NOT_FOUND:
        return 'NOT_FOUND';
      case HttpStatus.CONFLICT:
        return 'CONFLICT';
      case HttpStatus.UNPROCESSABLE_ENTITY:
        return 'UNPROCESSABLE_ENTITY';
      case HttpStatus.TOO_MANY_REQUESTS:
        return 'TOO_MANY_REQUESTS';
      default:
        if (status >= 500) {
          return 'INTERNAL_ERROR';
        }
        return 'HTTP_ERROR';
    }
  }
}
