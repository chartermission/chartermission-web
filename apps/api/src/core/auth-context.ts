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

/** How a request authenticated when it isn't a cookie session: Claude with an OAuth access token. */
export interface AuthVia {
  kind: 'oauth';
  grantId: string;
  clientName: string;
}

export interface AuthContext {
  user: AuthUser;
  session: AuthSession;
  /** Set for OAuth bearer requests (Claude); absent for cookie sessions. */
  via?: AuthVia;
}

export type AppRequest = Request & {
  auth?: AuthContext;
  requestId?: string;
  /** An OAuth access token was sent (valid or not); cookies are ignored for this request. */
  oauthBearer?: boolean;
};

export function clientIp(req: Request): string | undefined {
  return req.ip ?? req.socket.remoteAddress ?? undefined;
}
