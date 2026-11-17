import { Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, gt, isNull, or, sql } from 'drizzle-orm';
import {
  MCP_SCOPE,
  OAUTH_POLICY,
  type ConnectedAppsView,
  type OAuthAuthorizeCheck,
  type OAuthAuthorizeInput,
  type OAuthAuthorizeQuery,
  type OAuthAuthorizeResult,
} from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import type { Tx } from '../db/client.js';
import { mcpActions, oauthClients, oauthCodes, oauthGrants } from '../db/schema.js';
import { randomToken, safeEqual, sha256 } from '../common/crypto.js';
import { Errors } from '../common/errors.js';
import { env } from '../config/env.js';
import type { AuthContext, AuthUser } from '../core/auth-context.js';
import { MembersService } from '../core/members.service.js';
import { ROLES } from '../core/permissions.js';
import { isActiveUntil } from '../core/policy.js';
import { SessionService } from '../core/session.service.js';
import { hasMcpAccess } from './mcp-access.js';
import { OAuthError } from './oauth-errors.js';
import { verifyPkce } from './pkce.js';
import { allowedRedirectUris, isAllowedRedirectUri } from './redirect-uris.js';

type ClientRow = typeof oauthClients.$inferSelect;

/** Token prefixes: they make a leaked token easy to recognise (and to scan for). */
const PREFIX = { client: 'cmc_', code: 'cmac_', access: 'cmat_', refresh: 'cmrt_' } as const;

/** Statuses that may not be given new tokens or use the ones they have. */
const CLOSED = new Set(['deleted', 'deletion_pending', 'deactivated', 'suspended']);

/** Closed for Claude: one of the statuses above, or a suspension still running. */
const isClosed = (user: AuthUser) => CLOSED.has(user.status) || isActiveUntil(user.suspendedUntil);

/** A refresh retried with the token it just replaced (a lost response) is honoured this long. */
const REFRESH_RETRY_MS = 60_000;

export type TokenResponse = {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token: string;
  scope: string;
};

export type ClientRegistration = {
  client_id: string;
  client_name: string;
  redirect_uris: string[];
  grant_types: string[];
  response_types: string[];
  token_endpoint_auth_method: 'none';
  client_id_issued_at: number;
};

const str = (body: Record<string, unknown>, key: string): string | undefined => {
  const v = body[key];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
};

/**
 * Client names are shown on the consent page: control characters become spaces, format characters
 * (bidi overrides, zero-width joiners and the like) go, whitespace collapses.
 */
export const cleanClientName = (v: unknown): string =>
  typeof v === 'string'
    ? v
        .replace(/\p{Cc}/gu, ' ')
        .replace(/\p{Cf}/gu, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 80)
        .trim()
    : '';

/**
 * The OAuth 2.1 authorization server Claude connects through (authorization code + PKCE S256,
 * public clients, dynamic registration). Codes and tokens are stored as SHA-256 hashes only.
 */
@Injectable()
export class OAuthService {
  private readonly logger = new Logger('OAuth');

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly sessions: SessionService,
    private readonly members: MembersService,
  ) {}

  /* ------------------------------ Registration (RFC 7591) ------------------------------ */

  async register(body: Record<string, unknown>): Promise<ClientRegistration> {
    const uris = body.redirect_uris;
    if (!Array.isArray(uris) || uris.length < 1 || uris.length > 5 || !uris.every((u) => typeof u === 'string')) {
      throw new OAuthError('invalid_redirect_uri', 'Send 1 to 5 redirect_uris.');
    }
    const allowed = allowedRedirectUris(env().OAUTH_REDIRECT_URIS);
    for (const uri of uris as string[]) {
      if (!isAllowedRedirectUri(uri, allowed)) {
        throw new OAuthError('invalid_redirect_uri', `Redirect URI not allowed: ${uri.slice(0, 200)}`);
      }
    }
    if (body.client_name !== undefined && typeof body.client_name !== 'string') {
      throw new OAuthError('invalid_client_metadata', 'client_name must be a string.');
    }
    const name = cleanClientName(body.client_name) || 'Claude';
    const [row] = await this.db
      .insert(oauthClients)
      .values({ clientId: PREFIX.client + randomToken(18), clientName: name, redirectUris: [...new Set(uris as string[])] })
      .returning();
    return {
      client_id: row!.clientId,
      client_name: row!.clientName,
      redirect_uris: row!.redirectUris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      client_id_issued_at: Math.floor(row!.createdAt.getTime() / 1000),
    };
  }

  /* ------------------------------ Consent (member session) ------------------------------ */

  /** The client of an authorize request, with its redirect URI matched exactly; 400 otherwise. */
  private async authorizeClient(q: OAuthAuthorizeQuery): Promise<ClientRow> {
    const [client] = await this.db.select().from(oauthClients).where(eq(oauthClients.clientId, q.client_id)).limit(1);
    if (!client) throw Errors.badRequest('This app isn’t registered with Charter Mission. Try connecting again from Claude.');
    if (!client.redirectUris.includes(q.redirect_uri)) {
      throw Errors.badRequest('This connection request doesn’t match the app. Try connecting again from Claude.');
    }
    return client;
  }

  /** GET /oauth/authorize/check */
  async check(ctx: AuthContext, q: OAuthAuthorizeQuery): Promise<OAuthAuthorizeCheck> {
    const client = await this.authorizeClient(q);
    const member = await this.members.ref(ctx.user.id);
    if (!member) throw Errors.unauthenticated();
    return {
      client: { name: client.clientName, redirectHost: new URL(q.redirect_uri).host },
      member,
      allowed: await hasMcpAccess(this.db, ctx.user),
    };
  }

  /** POST /oauth/authorize: the member's answer, as the URL to send the browser back to. */
  async authorize(ctx: AuthContext, input: OAuthAuthorizeInput): Promise<OAuthAuthorizeResult> {
    const client = await this.authorizeClient(input);
    const back = new URL(input.redirect_uri);
    if (!input.approve) {
      back.searchParams.set('error', 'access_denied');
      if (input.state !== undefined) back.searchParams.set('state', input.state);
      return { redirectTo: back.toString() };
    }
    if (!(await hasMcpAccess(this.db, ctx.user))) {
      throw Errors.forbidden('Claude access isn’t turned on for this account. Ask the Charter Mission team.');
    }
    const code = PREFIX.code + randomToken(32);
    await this.db.insert(oauthCodes).values({
      codeHash: sha256(code),
      clientId: client.id,
      userId: ctx.user.id,
      redirectUri: input.redirect_uri,
      codeChallenge: input.code_challenge,
      scope: MCP_SCOPE,
      resource: input.resource ?? null,
      expiresAt: new Date(Date.now() + OAUTH_POLICY.codeTtlSeconds * 1000),
    });
    back.searchParams.set('code', code);
    if (input.state !== undefined) back.searchParams.set('state', input.state);
    return { redirectTo: back.toString() };
  }

  /* ------------------------------ Token endpoint ------------------------------ */

  async token(body: Record<string, unknown>): Promise<TokenResponse> {
    const grantType = str(body, 'grant_type');
    if (!grantType) throw new OAuthError('invalid_request', 'grant_type is required.');
    if (grantType === 'authorization_code') return this.exchangeCode(body);
    if (grantType === 'refresh_token') return this.refresh(body);
    throw new OAuthError('unsupported_grant_type', 'Use authorization_code or refresh_token.');
  }

  private async clientFor(body: Record<string, unknown>): Promise<ClientRow> {
    const clientId = str(body, 'client_id');
    if (!clientId) throw new OAuthError('invalid_request', 'client_id is required.');
    const [client] = await this.db.select().from(oauthClients).where(eq(oauthClients.clientId, clientId)).limit(1);
    if (!client) throw new OAuthError('invalid_client', 'Unknown client.');
    return client;
  }

  /** The account, when it may still be given tokens: open, and with Claude access. */
  private async eligibleUser(userId: string): Promise<AuthUser | null> {
    const user = await this.sessions.userById(userId);
    if (!user || isClosed(user)) return null;
    return (await hasMcpAccess(this.db, user)) ? user : null;
  }

  private async exchangeCode(body: Record<string, unknown>): Promise<TokenResponse> {
    const code = str(body, 'code');
    const redirectUri = str(body, 'redirect_uri');
    const verifier = str(body, 'code_verifier');
    if (!code || !redirectUri || !verifier) {
      throw new OAuthError('invalid_request', 'code, redirect_uri and code_verifier are required.');
    }
    const client = await this.clientFor(body);
    const now = new Date();
    const hash = sha256(code);
    // Single use: the first attempt claims the code, whatever happens next.
    const [row] = await this.db
      .update(oauthCodes)
      .set({ usedAt: now })
      .where(and(eq(oauthCodes.codeHash, hash), isNull(oauthCodes.usedAt)))
      .returning();
    if (!row) {
      // A replayed code: revoke the connection it was exchanged for (RFC 6749 4.1.2).
      const [used] = await this.db
        .select({ grantId: oauthCodes.grantId })
        .from(oauthCodes)
        .where(eq(oauthCodes.codeHash, hash))
        .limit(1);
      if (used?.grantId) {
        await this.revokeGrant(used.grantId);
        this.logger.warn(`Authorization code replayed; connection ${used.grantId} revoked`);
      }
      throw new OAuthError('invalid_grant', 'This authorization code is invalid or was already used.');
    }
    if (row.expiresAt.getTime() <= now.getTime()) throw new OAuthError('invalid_grant', 'This authorization code has expired.');
    if (row.clientId !== client.id) throw new OAuthError('invalid_grant', 'This code was issued to another client.');
    if (row.redirectUri !== redirectUri) throw new OAuthError('invalid_grant', 'redirect_uri does not match.');
    if (!verifyPkce(verifier, row.codeChallenge)) throw new OAuthError('invalid_grant', 'code_verifier does not match.');
    const user = await this.eligibleUser(row.userId);
    if (!user) throw new OAuthError('invalid_grant', 'This account can no longer connect Claude.');

    const tokens = this.newTokens(now);
    const grant = await this.db.transaction(async (tx) => {
      const [g] = await tx
        .insert(oauthGrants)
        .values({
          userId: row.userId,
          clientId: client.id,
          scope: row.scope,
          accessHash: sha256(tokens.access),
          accessExpiresAt: tokens.accessExpiresAt,
          refreshHash: sha256(tokens.refresh),
          refreshExpiresAt: tokens.refreshExpiresAt,
          lastUsedAt: now,
        })
        .returning();
      await tx.update(oauthCodes).set({ grantId: g!.id }).where(eq(oauthCodes.id, row.id));
      await tx.update(oauthClients).set({ lastUsedAt: now }).where(eq(oauthClients.id, client.id));
      return g!;
    });
    return this.tokenResponse(tokens, grant.scope);
  }

  /**
   * Refresh rotates both tokens on the connection's row. Presenting the refresh token that was just
   * replaced means it was copied (or replayed) and the connection is revoked, unless it comes within
   * REFRESH_RETRY_MS of the rotation from the same client: then it is a retry after a lost response
   * and gets a fresh pair.
   */
  private async refresh(body: Record<string, unknown>): Promise<TokenResponse> {
    const refreshToken = str(body, 'refresh_token');
    if (!refreshToken) throw new OAuthError('invalid_request', 'refresh_token is required.');
    const client = await this.clientFor(body);
    const hash = sha256(refreshToken);
    const now = new Date();
    const [grant] = await this.db.select().from(oauthGrants).where(eq(oauthGrants.refreshHash, hash)).limit(1);
    if (!grant) return this.refreshWithReplacedToken(hash, client, now);
    if (grant.revokedAt) throw new OAuthError('invalid_grant', 'This connection was disconnected.');
    if (grant.refreshExpiresAt.getTime() <= now.getTime()) throw new OAuthError('invalid_grant', 'This refresh token has expired.');
    if (grant.clientId !== client.id) throw new OAuthError('invalid_grant', 'This refresh token was issued to another client.');
    if (!(await this.eligibleUser(grant.userId))) {
      await this.revokeGrant(grant.id);
      throw new OAuthError('invalid_grant', 'This account can no longer connect Claude.');
    }
    const tokens = this.newTokens(now);
    const [rotated] = await this.db
      .update(oauthGrants)
      .set({ ...this.tokenColumns(tokens), previousRefreshHash: hash, rotatedAt: now, lastUsedAt: now, updatedAt: now })
      // Compare-and-swap: two refreshes with the same token can't both succeed.
      .where(and(eq(oauthGrants.id, grant.id), eq(oauthGrants.refreshHash, hash), isNull(oauthGrants.revokedAt)))
      .returning({ id: oauthGrants.id, scope: oauthGrants.scope });
    if (!rotated) throw new OAuthError('invalid_grant', 'This refresh token is invalid.');
    await this.db.update(oauthClients).set({ lastUsedAt: now }).where(eq(oauthClients.id, client.id));
    return this.tokenResponse(tokens, rotated.scope);
  }

  /** The presented refresh token isn't current: a retry within the window, a replay, or unknown. */
  private async refreshWithReplacedToken(hash: string, client: ClientRow, now: Date): Promise<TokenResponse> {
    const [old] = await this.db.select().from(oauthGrants).where(eq(oauthGrants.previousRefreshHash, hash)).limit(1);
    if (!old || old.revokedAt) throw new OAuthError('invalid_grant', 'This refresh token is invalid.');
    const retry =
      !!old.rotatedAt &&
      now.getTime() - old.rotatedAt.getTime() <= REFRESH_RETRY_MS &&
      old.clientId === client.id &&
      old.refreshExpiresAt.getTime() > now.getTime();
    if (!retry) {
      await this.revokeGrant(old.id);
      this.logger.warn(`Refresh token reused; connection ${old.id} revoked`);
      throw new OAuthError('invalid_grant', 'This refresh token is invalid.');
    }
    if (!(await this.eligibleUser(old.userId))) {
      await this.revokeGrant(old.id);
      throw new OAuthError('invalid_grant', 'This account can no longer connect Claude.');
    }
    // Rotate again; the presented token stays the "previous" one and the window isn't extended.
    const tokens = this.newTokens(now);
    const [rotated] = await this.db
      .update(oauthGrants)
      .set({ ...this.tokenColumns(tokens), lastUsedAt: now, updatedAt: now })
      .where(
        and(
          eq(oauthGrants.id, old.id),
          eq(oauthGrants.refreshHash, old.refreshHash),
          eq(oauthGrants.previousRefreshHash, hash),
          isNull(oauthGrants.revokedAt),
        ),
      )
      .returning({ id: oauthGrants.id, scope: oauthGrants.scope });
    if (!rotated) throw new OAuthError('invalid_grant', 'This refresh token is invalid.');
    return this.tokenResponse(tokens, rotated.scope);
  }

  private tokenColumns(tokens: ReturnType<OAuthService['newTokens']>) {
    return {
      accessHash: sha256(tokens.access),
      accessExpiresAt: tokens.accessExpiresAt,
      refreshHash: sha256(tokens.refresh),
      refreshExpiresAt: tokens.refreshExpiresAt,
    };
  }

  /** RFC 7009: revoke the connection an access or refresh token belongs to. Unknown tokens are fine. */
  async revoke(body: Record<string, unknown>): Promise<void> {
    const token = str(body, 'token');
    if (!token || token.length > 200) return;
    const hash = sha256(token);
    const [grant] = await this.db
      .select({ id: oauthGrants.id, clientId: oauthClients.clientId })
      .from(oauthGrants)
      .innerJoin(oauthClients, eq(oauthClients.id, oauthGrants.clientId))
      .where(and(or(eq(oauthGrants.accessHash, hash), eq(oauthGrants.refreshHash, hash)), isNull(oauthGrants.revokedAt)))
      .limit(1);
    if (!grant) return;
    // A client that names itself may only revoke its own tokens.
    const clientId = str(body, 'client_id');
    if (clientId && !safeEqual(clientId, grant.clientId)) return;
    await this.revokeGrant(grant.id);
  }

  private newTokens(now: Date) {
    return {
      access: PREFIX.access + randomToken(32),
      refresh: PREFIX.refresh + randomToken(32),
      accessExpiresAt: new Date(now.getTime() + OAUTH_POLICY.accessTokenTtlSeconds * 1000),
      refreshExpiresAt: new Date(now.getTime() + OAUTH_POLICY.refreshTokenTtlSeconds * 1000),
    };
  }

  private tokenResponse(tokens: ReturnType<OAuthService['newTokens']>, scope: string): TokenResponse {
    return {
      access_token: tokens.access,
      token_type: 'Bearer',
      expires_in: OAUTH_POLICY.accessTokenTtlSeconds,
      refresh_token: tokens.refresh,
      scope,
    };
  }

  /* ------------------------------ Bearer requests ------------------------------ */

  /** Whether an Authorization header carries one of our access tokens (then cookies are ignored). */
  static bearerToken(header: string | undefined): string | null {
    if (!header) return null;
    const m = /^Bearer\s+(\S+)\s*$/i.exec(header);
    return m && m[1]!.startsWith(PREFIX.access) ? m[1]! : null;
  }

  /**
   * The member an access token acts for, or null when the token is unknown, expired or revoked, or
   * the account lost Claude access. Permissions are cut down to a plain member's: whatever roles
   * the account holds, Claude never moderates, announces or administers.
   */
  async resolveBearer(token: string): Promise<AuthContext | null> {
    if (token.length > 200) return null;
    const now = new Date();
    const [row] = await this.db
      .select({ grant: oauthGrants, clientName: oauthClients.clientName })
      .from(oauthGrants)
      .innerJoin(oauthClients, eq(oauthClients.id, oauthGrants.clientId))
      .where(
        and(eq(oauthGrants.accessHash, sha256(token)), isNull(oauthGrants.revokedAt), gt(oauthGrants.accessExpiresAt, now)),
      )
      .limit(1);
    if (!row) return null;
    const user = await this.sessions.userById(row.grant.userId);
    if (!user || isClosed(user) || !(await hasMcpAccess(this.db, user))) return null;
    // Touch at most once a minute to keep writes cheap.
    if (!row.grant.lastUsedAt || now.getTime() - row.grant.lastUsedAt.getTime() > 60_000) {
      await this.db.update(oauthGrants).set({ lastUsedAt: now }).where(eq(oauthGrants.id, row.grant.id));
      await this.db.update(oauthClients).set({ lastUsedAt: now }).where(eq(oauthClients.id, row.grant.clientId));
    }
    return {
      user: { ...user, permissions: new Set(ROLES.member!.permissions) },
      session: {
        id: row.grant.id,
        audience: 'member',
        mfaVerified: true,
        mfaVerifiedAt: row.grant.createdAt,
        createdAt: row.grant.createdAt,
      },
      via: { kind: 'oauth', grantId: row.grant.id, clientName: row.clientName },
    };
  }

  /* ------------------------------ Connections ------------------------------ */

  async revokeGrant(grantId: string, tx?: Tx): Promise<void> {
    await (tx ?? this.db)
      .update(oauthGrants)
      .set({ revokedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(oauthGrants.id, grantId), isNull(oauthGrants.revokedAt)));
  }

  /** Disconnects every Claude connection on an account (admin turned access off). Returns how many. */
  async revokeAllForUser(userId: string, tx?: Tx): Promise<number> {
    const rows = await (tx ?? this.db)
      .update(oauthGrants)
      .set({ revokedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(oauthGrants.userId, userId), isNull(oauthGrants.revokedAt)))
      .returning({ id: oauthGrants.id });
    return rows.length;
  }

  /** GET /me/connected-apps: live connections (not revoked, refresh token still valid). */
  async connectedApps(ctx: AuthContext): Promise<ConnectedAppsView> {
    const since = new Date(Date.now() - 7 * 24 * 3600_000);
    const rows = await this.db
      .select({
        id: oauthGrants.id,
        clientName: oauthClients.clientName,
        createdAt: oauthGrants.createdAt,
        lastUsedAt: oauthGrants.lastUsedAt,
        actions: sql<number>`(select count(*)::int from ${mcpActions} a where a.grant_id = ${oauthGrants.id} and a.created_at > ${since})`,
      })
      .from(oauthGrants)
      .innerJoin(oauthClients, eq(oauthClients.id, oauthGrants.clientId))
      .where(
        and(eq(oauthGrants.userId, ctx.user.id), isNull(oauthGrants.revokedAt), gt(oauthGrants.refreshExpiresAt, new Date())),
      )
      .orderBy(desc(oauthGrants.createdAt));
    return {
      mcpAccess: await hasMcpAccess(this.db, ctx.user),
      apps: rows.map((r) => ({
        id: r.id,
        clientName: r.clientName,
        connectedAt: r.createdAt.toISOString(),
        lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
        actionsLast7Days: r.actions,
      })),
    };
  }

  /** DELETE /me/connected-apps/{id}: the member disconnects one of their own connections. */
  async disconnect(ctx: AuthContext, grantId: string): Promise<void> {
    const rows = await this.db
      .update(oauthGrants)
      .set({ revokedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(oauthGrants.id, grantId), eq(oauthGrants.userId, ctx.user.id), isNull(oauthGrants.revokedAt)))
      .returning({ id: oauthGrants.id });
    if (!rows.length) throw Errors.notFound('That connection');
  }
}
