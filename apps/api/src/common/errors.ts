import { HttpException } from '@nestjs/common';
import type { ErrorCode } from '@chartermission/contracts';

/**
 * The one error type handlers throw. Serialised by ErrorFilter as
 * { error: { code, message, fields?, retryAfter? } } (spec 6.1).
 */
export class AppError extends HttpException {
  constructor(
    status: number,
    readonly code: ErrorCode,
    message: string,
    readonly fields?: Record<string, string>,
    readonly retryAfter?: number,
  ) {
    super(message, status);
  }
}

export const Errors = {
  validation: (fields: Record<string, string>, message = 'Check the highlighted fields') =>
    new AppError(422, 'VALIDATION_FAILED', message, fields),
  badRequest: (message: string) => new AppError(400, 'VALIDATION_FAILED', message),
  unauthenticated: () => new AppError(401, 'UNAUTHENTICATED', 'Sign in to continue'),
  invalidCredentials: () => new AppError(401, 'INVALID_CREDENTIALS', 'That email and password don’t match'),
  emailNotVerified: () =>
    new AppError(403, 'EMAIL_NOT_VERIFIED', 'Verify your email address to do this. Check your inbox for the link.'),
  suspended: (until?: Date | null) =>
    new AppError(
      403,
      'ACCOUNT_SUSPENDED',
      until ? `Your account is suspended until ${until.toISOString().slice(0, 10)}` : 'Your account is suspended',
    ),
  deactivated: () => new AppError(403, 'ACCOUNT_DEACTIVATED', 'Your account is deactivated. Reactivate it to continue.'),
  restricted: (what: 'posting' | 'connecting', until: Date) =>
    new AppError(
      403,
      'ACCOUNT_RESTRICTED',
      `You can’t use ${what} until ${until.toISOString().slice(0, 16).replace('T', ' ')} UTC`,
    ),
  forbidden: (message = 'You don’t have permission to do that') => new AppError(403, 'FORBIDDEN', message),
  blocked: () => new AppError(403, 'BLOCKED', 'You can’t interact with this member'),
  notFound: (what = 'That item') => new AppError(404, 'NOT_FOUND', `${what} was not found`),
  conflict: (message: string) => new AppError(409, 'CONFLICT', message),
  invalidToken: () => new AppError(400, 'INVALID_TOKEN', 'This link is invalid or has expired. Request a new one.'),
  /** `reason` explains which limit was reached (e.g. "You can send 2 message requests a day."). */
  rateLimited: (retryAfter: number, reason?: string) =>
    new AppError(429, 'RATE_LIMITED', reason ?? 'Too many attempts. Try again later.', undefined, retryAfter),
  mfaRequired: () => new AppError(403, 'MFA_REQUIRED', 'Enter your authenticator code to continue'),
  mfaSetupRequired: () => new AppError(403, 'MFA_SETUP_REQUIRED', 'Set up two-step verification to continue'),
  invalidMfa: () => new AppError(400, 'INVALID_MFA_CODE', 'That code is not right. Try the latest one.'),
  policyReaccept: () =>
    new AppError(403, 'POLICY_REACCEPT_REQUIRED', 'Our policies have changed. Review and accept them to continue.'),
  csrf: () => new AppError(403, 'CSRF_FAILED', 'Request blocked. Refresh the page and try again.'),
  preconditionFailed: () => new AppError(412, 'PRECONDITION_FAILED', 'This was changed by someone else. Reload and try again.'),
  tooLarge: (message: string) => new AppError(413, 'PAYLOAD_TOO_LARGE', message),
  unsupportedMedia: (message: string) => new AppError(415, 'UNSUPPORTED_MEDIA', message),
  unavailable: (message: string) => new AppError(503, 'UNAVAILABLE', message),
};
