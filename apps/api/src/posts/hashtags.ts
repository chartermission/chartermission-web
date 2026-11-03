import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Tx } from '../db/client.js';
import type { Db } from '../db/db.module.js';
import { hashtags, postHashtags } from '../db/schema.js';
import type { ParsedTag } from './text-parse.js';

type Conn = Db | Tx;

/**
 * Upsert hashtags (lower-case `tag`, display form from first use) and link them to a post,
 * keeping hashtags.post_count in step. Other modules may insert hashtag rows too
 * (onConflictDoNothing), so this always upserts.
 */
export async function attachHashtags(tx: Conn, postId: string, tags: ParsedTag[]): Promise<void> {
  for (const t of tags) {
    const [row] = await tx
      .insert(hashtags)
      .values({ tag: t.tag, display: t.display, postCount: 1 })
      .onConflictDoUpdate({ target: hashtags.tag, set: { postCount: sql`${hashtags.postCount} + 1` } })
      .returning({ id: hashtags.id });
    await tx.insert(postHashtags).values({ postId, hashtagId: row!.id }).onConflictDoNothing();
  }
}

/** Remove some or all of a post's hashtags (edit or delete), decrementing counts. */
export async function detachHashtags(tx: Conn, postId: string, tagKeys?: string[]): Promise<void> {
  const linked = await tx
    .select({ id: hashtags.id, tag: hashtags.tag })
    .from(postHashtags)
    .innerJoin(hashtags, eq(hashtags.id, postHashtags.hashtagId))
    .where(eq(postHashtags.postId, postId));
  const remove = tagKeys ? linked.filter((l) => tagKeys.includes(l.tag)) : linked;
  if (!remove.length) return;
  const ids = remove.map((r) => r.id);
  await tx.delete(postHashtags).where(and(eq(postHashtags.postId, postId), inArray(postHashtags.hashtagId, ids)));
  await tx
    .update(hashtags)
    .set({ postCount: sql`greatest(${hashtags.postCount} - 1, 0)` })
    .where(inArray(hashtags.id, ids));
}

/** Re-sync a post's hashtags after an edit. */
export async function syncHashtags(tx: Conn, postId: string, tags: ParsedTag[]): Promise<void> {
  const current = await tx
    .select({ tag: hashtags.tag })
    .from(postHashtags)
    .innerJoin(hashtags, eq(hashtags.id, postHashtags.hashtagId))
    .where(eq(postHashtags.postId, postId));
  const have = new Set(current.map((c) => c.tag));
  const want = new Set(tags.map((t) => t.tag));
  await detachHashtags(
    tx,
    postId,
    [...have].filter((t) => !want.has(t)),
  );
  await attachHashtags(
    tx,
    postId,
    tags.filter((t) => !have.has(t.tag)),
  );
}
