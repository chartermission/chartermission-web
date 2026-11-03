import { Injectable } from '@nestjs/common';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { InjectDb, type Db } from '../db/db.module.js';
import type { Tx } from '../db/client.js';
import { authTokens } from '../db/schema.js';
import { randomToken, sha256 } from '../common/crypto.js';
import { Errors } from '../common/errors.js';

export type TokenPurpose = 'verify' | 'reset';

/** Lifetimes (spec 4.2, proposed): verification 24 hours, password reset 60 minutes. */
export const TOKEN_TTL_MS: Record<TokenPurpose, number> = {
  verify: 24 * 3600_000,
  reset: 60 * 60_000,
};

/** Single-use email tokens; only a SHA-256 of the token is stored (spec 5.1 AuthToken). */
@Injectable()
export class TokensService {
  constructor(@InjectDb() private readonly db: Db) {}

  /** Issue a new token, retiring any earlier unused token for the same purpose. Returns the raw token. */
  async issue(userId: string, purpose: TokenPurpose, tx?: Tx): Promise<string> {
    const db = tx ?? this.db;
    const now = new Date();
    await db
      .update(authTokens)
      .set({ usedAt: now })
      .where(and(eq(authTokens.userId, userId), eq(authTokens.purpose, purpose), isNull(authTokens.usedAt)));
    const token = randomToken(32);
    await db.insert(authTokens).values({
      userId,
      purpose,
      tokenHash: sha256(token),
      expiresAt: new Date(now.getTime() + TOKEN_TTL_MS[purpose]),
    });
    return token;
  }

  /** Retire every unused token of a purpose (e.g. after the email is verified). */
  async retireAll(userId: string, purpose: TokenPurpose, tx?: Tx): Promise<void> {
    await (tx ?? this.db)
      .update(authTokens)
      .set({ usedAt: new Date() })
      .where(and(eq(authTokens.userId, userId), eq(authTokens.purpose, purpose), isNull(authTokens.usedAt)));
  }

  /** The user a live token belongs to, without consuming it. Generic error otherwise. */
  async peek(token: string, purpose: TokenPurpose): Promise<string> {
    const [row] = await this.db
      .select({ userId: authTokens.userId })
      .from(authTokens)
      .where(this.live(token, purpose))
      .limit(1);
    if (!row) throw Errors.invalidToken();
    return row.userId;
  }

  /** Atomically mark a live token used. Expired, used or unknown tokens fail generically. */
  async consume(token: string, purpose: TokenPurpose, tx?: Tx): Promise<string> {
    const [row] = await (tx ?? this.db)
      .update(authTokens)
      .set({ usedAt: new Date() })
      .where(this.live(token, purpose))
      .returning({ userId: authTokens.userId });
    if (!row) throw Errors.invalidToken();
    return row.userId;
  }

  private live(token: string, purpose: TokenPurpose) {
    return and(
      eq(authTokens.tokenHash, sha256(token)),
      eq(authTokens.purpose, purpose),
      isNull(authTokens.usedAt),
      gt(authTokens.expiresAt, new Date()),
    );
  }
}
