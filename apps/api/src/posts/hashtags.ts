import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { Tx } from '../db/client.js';
import type { Db } from '../db/db.module.js';
import { groups, hashtags, postHashtags, posts } from '../db/schema.js';
import type { ParsedTag } from './text-parse.js';

type Conn = Db | Tx;

/** SQL: the post (its id in `postIdCol`) is a private group's: marked 'group', or in a group that is private. */
export function privateGroupPostSql(postIdCol: SQL): SQL {
  return sql`exists (select 1 from ${posts} pgp left join ${groups} pgg on pgg.id = pgp.group_id
    where pgp.id = ${postIdCol} and (pgp.visibility = 'group' or pgg.visibility = 'private'))`;
}

/**
 * Recount hashtags.post_count for these hashtags. Private group posts are left out, so a tag used only
 * inside private groups never shows on /topics or gives away activity there.
 */
export async function recountHashtags(tx: Conn, hashtagIds: string[]): Promise<void> {
  if (!hashtagIds.length) return;
  await tx
    .update(hashtags)
    .set({
      postCount: sql`(select count(*)::int from ${postHashtags} rph join ${posts} rp on rp.id = rph.post_id where rph.hashtag_id = ${hashtags.id} and rp.deleted_at is null and not ${privateGroupPostSql(sql`rp.id`)})`,
    })
    .where(inArray(hashtags.id, hashtagIds));
}

/** Recount the hashtags of every post in a group (after the group switched between public and private). */
export async function recountGroupHashtags(tx: Conn, groupId: string): Promise<void> {
  const rows = await tx
    .selectDistinct({ id: postHashtags.hashtagId })
    .from(postHashtags)
    .innerJoin(posts, eq(posts.id, postHashtags.postId))
    .where(eq(posts.groupId, groupId));
  await recountHashtags(
    tx,
    rows.map((r) => r.id),
  );
}

/**
 * Upsert hashtags (lower-case `tag`, display form from first use) and link them to a post,
 * keeping hashtags.post_count in step. Other modules may insert hashtag rows too
 * (onConflictDoNothing), so this always upserts.
 */
export async function attachHashtags(tx: Conn, postId: string, tags: ParsedTag[]): Promise<void> {
  const ids: string[] = [];
  for (const t of tags) {
    const [row] = await tx
      .insert(hashtags)
      .values({ tag: t.tag, display: t.display, postCount: 0 })
      .onConflictDoUpdate({ target: hashtags.tag, set: { tag: sql`excluded.tag` } })
      .returning({ id: hashtags.id });
    await tx.insert(postHashtags).values({ postId, hashtagId: row!.id }).onConflictDoNothing();
    ids.push(row!.id);
  }
  await recountHashtags(tx, ids);
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
  await recountHashtags(tx, ids);
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
