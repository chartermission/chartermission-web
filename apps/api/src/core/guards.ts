import {
  applyDecorators,
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  Injectable,
  SetMetadata,
  UseGuards,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { env } from '../config/env.js';
import { Errors } from '../common/errors.js';
import type { AppRequest, AuthContext } from './auth-context.js';
import { mustUseMfa, type Permission } from './permissions.js';
import { isActiveUntil } from './policy.js';

/**
 * Access levels (spec 4.2 rules, 4.17):
 *  - "session": any signed-in account, including unverified, suspended or deactivated
 *    (they can still read /me, finish onboarding, edit their profile or appeal).
 *  - "member": signed in and not suspended/deactivated; unverified allowed.
 *  - "verified": as "member" plus a verified email (posting, commenting, reacting, connecting, reporting).
 *  - "admin": an admin-audience session with MFA verified and the admin.console permission.
 */
export type AccessLevel = 'session' | 'member' | 'verified' | 'admin';

const ACCESS_KEY = 'cm:access';
const PERMISSION_KEY = 'cm:permissions';
const SKIP_CSRF_KEY = 'cm:skip-csrf';
const ALLOW_PENDING_MFA_KEY = 'cm:allow-pending-mfa';

export function checkAccess(
  ctx: AuthContext | undefined,
  level: AccessLevel,
  perms: Permission[] = [],
  allowPendingMfa = false,
): AuthContext {
  if (!ctx) throw Errors.unauthenticated();
  const { user, session } = ctx;
  // Accounts with two-step verification on must enter a code after signing in (any audience)
  // before using the session, apart from the few routes that finish or end sign-in.
  if (level !== 'admin' && user.mfaEnabled && !session.mfaVerified && !allowPendingMfa) throw Errors.mfaRequired();
  // Staff accounts must set up two-step verification before using the member app too (only the
  // session-level routes that show the account and run the setup stay open).
  if ((level === 'member' || level === 'verified') && !user.mfaEnabled && !allowPendingMfa && mustUseMfa(user)) {
    throw Errors.mfaSetupRequired();
  }
  if (level !== 'session') {
    if (user.status === 'suspended' || isActiveUntil(user.suspendedUntil)) throw Errors.suspended(user.suspendedUntil);
    if (user.status === 'deactivated' || user.status === 'deletion_pending') throw Errors.deactivated();
  }
  if (level === 'verified' && !user.emailVerified) throw Errors.emailNotVerified();
  if (level === 'admin') {
    if (session.audience !== 'admin' || !user.permissions.has('admin.console')) throw Errors.forbidden();
    if (!user.mfaEnabled) throw Errors.mfaSetupRequired();
    if (!session.mfaVerified) throw Errors.mfaRequired();
  }
  for (const p of perms) if (!user.permissions.has(p)) throw Errors.forbidden();
  return ctx;
}

@Injectable()
export class AccessGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const level = this.reflector.getAllAndOverride<AccessLevel | undefined>(ACCESS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!level) return true;
    const perms =
      this.reflector.getAllAndOverride<Permission[] | undefined>(PERMISSION_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];
    const allowPendingMfa =
      this.reflector.getAllAndOverride<boolean | undefined>(ALLOW_PENDING_MFA_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? false;
    const req = context.switchToHttp().getRequest<AppRequest>();
    checkAccess(req.auth, level, perms, allowPendingMfa);
    return true;
  }
}

/** `@Access('verified')` on a controller or handler; optional permissions are all required. */
export const Access = (level: AccessLevel, ...permissions: Permission[]) =>
  applyDecorators(SetMetadata(ACCESS_KEY, level), SetMetadata(PERMISSION_KEY, permissions), UseGuards(AccessGuard));

/** The AuthContext (throws 401 if absent). Use with @Access. */
export const Auth = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthContext => {
  const req = ctx.switchToHttp().getRequest<AppRequest>();
  if (!req.auth) throw Errors.unauthenticated();
  return req.auth;
});

/** The AuthContext or undefined, for endpoints that also serve visitors. */
export const OptionalAuth = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthContext | undefined => ctx.switchToHttp().getRequest<AppRequest>().auth,
);

/** For signed requests that cannot carry the CSRF header (signed upload URLs, provider webhooks). */
export const SkipCsrf = () => SetMetadata(SKIP_CSRF_KEY, true);

/** Usable before the sign-in MFA code is entered (GET /me, verifying the code, account basics). */
export const AllowPendingMfa = () => SetMetadata(ALLOW_PENDING_MFA_KEY, true);

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
export const CSRF_HEADER = 'x-cm-csrf';

/**
 * CSRF protection (spec 6.1, 8.1): SameSite=Lax cookies, plus on every state-changing
 * request an allowed Origin (or Referer) and a custom header that cross-site forms
 * cannot send without a CORS preflight.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AppRequest>();
    if (!UNSAFE.has(req.method)) return true;
    const skip = this.reflector.getAllAndOverride<boolean | undefined>(SKIP_CSRF_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) return true;
    if (req.headers[CSRF_HEADER] !== '1') throw Errors.csrf();
    const origin = req.headers.origin ?? refererOrigin(req.headers.referer);
    // Server-to-server calls from the Next apps carry no Origin; they still need the header.
    if (origin && !allowedOrigins().has(origin)) throw Errors.csrf();
    return true;
  }
}

function refererOrigin(referer: string | undefined): string | undefined {
  if (!referer) return undefined;
  try {
    return new URL(referer).origin;
  } catch {
    return undefined;
  }
}

let origins: Set<string> | undefined;
export function allowedOrigins(): Set<string> {
  origins ??= new Set(
    env()
      .WEB_ORIGINS.split(',')
      .map((o) => o.trim())
      .filter(Boolean),
  );
  return origins;
}
