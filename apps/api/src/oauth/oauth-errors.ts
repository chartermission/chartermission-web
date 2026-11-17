import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { AppError } from '../common/errors.js';

export type OAuthErrorCode =
  | 'invalid_request'
  | 'invalid_client'
  | 'invalid_grant'
  | 'unsupported_grant_type'
  | 'invalid_redirect_uri'
  | 'invalid_client_metadata'
  | 'rate_limited'
  | 'server_error';

/** An error from the OAuth server endpoints, answered in RFC 6749 / 7591 form. */
export class OAuthError extends Error {
  constructor(
    readonly error: OAuthErrorCode,
    readonly description: string,
    readonly status = 400,
  ) {
    super(description);
  }
}

/**
 * The OAuth endpoints Claude calls (register, token, revoke) answer `{ error, error_description }`
 * as the RFCs require, not the app's `{ error: { code, message } }` envelope. Never cached.
 */
@Catch()
export class OAuthErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger('OAuth');

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    let status = 400;
    let body: { error: OAuthErrorCode; error_description: string };
    if (exception instanceof OAuthError) {
      status = exception.status;
      body = { error: exception.error, error_description: exception.description };
    } else if (exception instanceof AppError && exception.getStatus() === 429) {
      status = 429;
      if (exception.retryAfter) res.setHeader('Retry-After', String(exception.retryAfter));
      body = { error: 'rate_limited', error_description: exception.message };
    } else if (exception instanceof HttpException && exception.getStatus() < 500) {
      body = { error: 'invalid_request', error_description: exception.message };
    } else {
      this.logger.error(exception instanceof Error ? exception.stack : String(exception));
      status = 500;
      body = { error: 'server_error', error_description: 'Something went wrong. Please try again.' };
    }
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
    res.status(status).json(body);
  }
}
