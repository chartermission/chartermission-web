import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { ZodError } from 'zod';
import type { ApiError, ErrorCode } from '@chartermission/contracts';
import { AppError } from './errors.js';
import { env } from '../config/env.js';

const statusCodes: Record<number, ErrorCode> = {
  400: 'VALIDATION_FAILED',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA',
  422: 'VALIDATION_FAILED',
  429: 'RATE_LIMITED',
};

export function zodFields(error: ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    fields[key] ??= issue.message;
  }
  return fields;
}

/** Every error leaves the API in the spec 6.1 shape; internals are never leaked. */
@Catch()
export class ErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger('Error');

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    let status = 500;
    let body: ApiError = { error: { code: 'INTERNAL', message: 'Something went wrong. Please try again.' } };

    if (exception instanceof AppError) {
      status = exception.getStatus();
      body = {
        error: {
          code: exception.code,
          message: exception.message,
          ...(exception.fields ? { fields: exception.fields } : {}),
          ...(exception.retryAfter ? { retryAfter: exception.retryAfter } : {}),
        },
      };
      if (exception.retryAfter) res.setHeader('Retry-After', String(exception.retryAfter));
    } else if (exception instanceof ZodError) {
      status = 422;
      body = { error: { code: 'VALIDATION_FAILED', message: 'Check the highlighted fields', fields: zodFields(exception) } };
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const code = statusCodes[status] ?? 'INTERNAL';
      const message = status === 404 ? 'Not found' : exception.message;
      body = { error: { code, message } };
    } else {
      this.logger.error(exception instanceof Error ? exception.stack : String(exception));
      // Local development only: name the real cause so it shows on the page, not just in the API terminal.
      if (env().NODE_ENV === 'development') {
        const root = exception instanceof Error && exception.cause instanceof Error ? exception.cause : exception;
        const cause = root instanceof Error ? root.message : String(root);
        body = { error: { code: 'INTERNAL', message: `Something went wrong: ${cause}`.slice(0, 500) } };
      }
    }
    res.status(status).json(body);
  }
}
