import { Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import { and, eq, gt, isNull, ne, sql } from 'drizzle-orm';
import { InjectDb, type Db } from '../db/db.module.js';
import { roles, rolePermissions, sessions, userRoles, users, memberProfiles } from '../db/schema.js';
import { env, isProd } from '../config/env.js';
import { hashIp, randomToken, sha256 } from '../common/crypto.js';
import type { AuthContext } from './auth-context.js';
import { ROLES, type Permission } from './permissions.js';

/** Session lifetimes (spec 4.2, proposed values). */
export const SESSION_POLICY = {
  member: { idleMs: 14 * 24 * 3600_000, absoluteMs: 30 * 24 * 3600_000 },
  admin: { idleMs: 30 * 60_000, absoluteMs: 12 * 3600_000 },
} as const;

export const COOKIE_NAMES = { member: 'cm_session', admin: 'cm_admin_session' } as const;
export type Audience = keyof typeof COOKIE_NAMES;

/** The admin app marks its requests with this header so the admin cookie is used. */
export const AUDIENCE_HEADER = 'x-cm-audience';

export function audienceOf(req: Request): Audience {
  return req.headers[AUDIENCE_HEADER] === 'admin' ? 'admin' : 'member';
}

/**
 * Server-side sessions in HttpOnly cookies (CM-AUTH-03, spec 8.1).
 * Only a SHA-256 of the token is stored; rotation on login and privilege change.
 */
@Injectable()
export class SessionService {
  constructor(@InjectDb() private readonly db: Db) {}

  async create(userId: string, audience: Audience, req: Request, opts: { mfaVerified?: boolean } = {}) {
    const token = randomToken(32);
    const now = Date.now();
    const policy = SESSION_POLICY[audience];
    const [row] = await this.db
      .insert(sessions)
      .values({
        userId,
        tokenHash: sha256(token),
        audience,
        ipHash: hashIp(req.ip),
        userAgent: (req.headers['user-agent'] ?? '').slice(0, 300) || null,
        mfaVerifiedAt: opts.mfaVerified ? new Date(now) : null,
        idleExpiresAt: new Date(now + policy.idleMs),
        expiresAt: new Date(now + policy.absoluteMs),
      })
      .returning({ id: sessions.id });
    return { token, sessionId: row!.id, expiresAt: new Date(now + policy.absoluteMs) };
  }

  setCookie(res: Response, audience: Audience, token: string, expiresAt: Date) {
    res.cookie(COOKIE_NAMES[audience], token, {
      httpOnly: true,
      secure: isProd(),
      sameSite: 'lax',
      path: '/',
      expires: expiresAt,
      ...(env().COOKIE_DOMAIN ? { domain: env().COOKIE_DOMAIN } : {}),
    });
  }

  clearCookie(res: Response, audience: Audience) {
    res.clearCookie(COOKIE_NAMES[audience], {
      httpOnly: true,
      secure: isProd(),
      sameSite: 'lax',
      path: '/',
      ...(env().COOKIE_DOMAIN ? { domain: env().COOKIE_DOMAIN } : {}),
    });
  }

  /** Resolve a cookie token to a live session and its user, sliding the idle expiry. */
  async resolve(token: string, audience: Audience): Promise<AuthContext | null> {
    const now = new Date();
    const rows = await this.db
      .select({
        session: sessions,
        user: users,
        countryCode: memberProfiles.countryCode,
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .leftJoin(memberProfiles, eq(memberProfiles.userId, users.id))
      .where(
        and(
          eq(sessions.tokenHash, sha256(token)),
          eq(sessions.audience, audience),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, now),
          gt(sessions.idleExpiresAt, now),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row || row.user.status === 'deleted') return null;

    const policy = SESSION_POLICY[audience];
    // Touch at most once a minute to keep writes cheap.
    if (now.getTime() - row.session.lastSeenAt.getTime() > 60_000) {
      await this.db
        .update(sessions)
        .set({ lastSeenAt: now, idleExpiresAt: new Date(now.getTime() + policy.idleMs) })
        .where(eq(sessions.id, row.session.id));
    }

    const roleRows = await this.db
      .select({ key: roles.key, permission: rolePermissions.permissionKey })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
      .where(and(eq(userRoles.userId, row.user.id), isNull(userRoles.revokedAt)));

    const roleKeys = new Set<string>(['member']);
    const permissions = new Set<Permission>(ROLES.member!.permissions);
    for (const r of roleRows) {
      roleKeys.add(r.key);
      if (r.permission) permissions.add(r.permission as Permission);
    }

    return {
      session: {
        id: row.session.id,
        audience,
        mfaVerified: !!row.session.mfaVerifiedAt,
        createdAt: row.session.createdAt,
      },
      user: {
        id: row.user.id,
        email: row.user.email,
        status: row.user.status as AuthContext['user']['status'],
        emailVerified: !!row.user.emailVerifiedAt,
        isStaff: row.user.isStaff,
        roles: [...roleKeys],
        permissions,
        mfaEnabled: !!row.user.mfaEnabledAt,
        suspendedUntil: row.user.suspendedUntil,
        restrictedPostingUntil: row.user.restrictedPostingUntil,
        restrictedConnectingUntil: row.user.restrictedConnectingUntil,
        countryCode: row.countryCode ?? null,
      },
    };
  }

  async markMfaVerified(sessionId: string) {
    await this.db.update(sessions).set({ mfaVerifiedAt: new Date() }).where(eq(sessions.id, sessionId));
  }

  async revoke(sessionId: string) {
    await this.db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, sessionId));
  }

  /** Revoke every session for a user, optionally keeping one (password change keeps the current one). */
  async revokeAll(userId: string, exceptSessionId?: string) {
    await this.db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(sessions.userId, userId),
          isNull(sessions.revokedAt),
          exceptSessionId ? ne(sessions.id, exceptSessionId) : sql`true`,
        ),
      );
  }
}
