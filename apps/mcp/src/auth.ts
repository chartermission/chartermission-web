import { createHash } from 'node:crypto';
import type { SessionUser } from '@chartermission/contracts';

/** How long a token the API accepted is trusted without asking again. Failures are never cached. */
const CACHE_TTL_MS = 30_000;
const CACHE_MAX = 5_000;

const cacheKey = (token: string) => createHash('sha256').update(token).digest('hex');

export type TokenCheck =
  | { ok: true; user: Pick<SessionUser, 'id' | 'handle'> }
  | { ok: false; reason: 'invalid' }
  | { ok: false; reason: 'unavailable' };

/**
 * Checks bearer tokens by asking the API who they belong to (GET /me). The API is the only
 * authority on tokens; this cache just saves a round trip per MCP request. A revoked token can
 * pass here for up to 30 seconds, but every tool call goes to the API, which refuses it, and the
 * first 401 from the API drops the token from the cache (forget).
 */
export class TokenVerifier {
  private readonly cache = new Map<string, { user: Pick<SessionUser, 'id' | 'handle'>; expires: number }>();

  constructor(
    private readonly apiUrl: string,
    private readonly now: () => number = Date.now,
  ) {}

  /** The API refused this token: stop trusting it now rather than when the cache entry expires. */
  forget(token: string) {
    this.cache.delete(cacheKey(token));
  }

  async verify(token: string): Promise<TokenCheck> {
    const key = cacheKey(token);
    const hit = this.cache.get(key);
    if (hit && hit.expires > this.now()) return { ok: true, user: hit.user };
    if (hit) this.cache.delete(key);

    let res: Response;
    try {
      res = await fetch(`${this.apiUrl}/me`, {
        headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      return { ok: false, reason: 'unavailable' };
    }
    if (res.status === 401 || res.status === 403) return { ok: false, reason: 'invalid' };
    if (!res.ok) return { ok: false, reason: 'unavailable' };
    const me = (await res.json().catch(() => null)) as SessionUser | null;
    if (!me?.id) return { ok: false, reason: 'unavailable' };

    const user = { id: me.id, handle: me.handle };
    if (this.cache.size >= CACHE_MAX) this.prune();
    this.cache.set(key, { user, expires: this.now() + CACHE_TTL_MS });
    return { ok: true, user };
  }

  private prune() {
    const now = this.now();
    for (const [key, entry] of this.cache) if (entry.expires <= now) this.cache.delete(key);
    // Still full of live entries: drop the oldest (Map keeps insertion order).
    while (this.cache.size >= CACHE_MAX) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
  }
}
