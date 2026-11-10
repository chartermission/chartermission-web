import type { Request } from 'express';
import type { Permission } from './permissions.js';

/** The signed-in account attached to each request by SessionMiddleware. */
export interface AuthUser {
  id: string;
  email: string;
  status: 'unverified' | 'active' | 'deactivated' | 'suspended' | 'deletion_pending' | 'deleted';
  emailVerified: boolean;
  isStaff: boolean;
  /** Follow-only organisation account. */
  isOfficial: boolean;
  locale: string | null;
  roles: string[];
  permissions: Set<Permission>;
  mfaEnabled: boolean;
  suspendedUntil: Date | null;
  restrictedPostingUntil: Date | null;
  restrictedConnectingUntil: Date | null;
  countryCode: string | null;
}

export interface AuthSession {
  id: string;
  audience: 'member' | 'admin';
  mfaVerified: boolean;
  mfaVerifiedAt: Date | null;
  createdAt: Date;
}

export interface AuthContext {
  user: AuthUser;
  session: AuthSession;
}

export type AppRequest = Request & { auth?: AuthContext; requestId?: string };

export function clientIp(req: Request): string | undefined {
  return req.ip ?? req.socket.remoteAddress ?? undefined;
}
