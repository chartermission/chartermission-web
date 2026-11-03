import { and, eq, inArray } from 'drizzle-orm';
import type { Tx } from '../db/client.js';
import type { Db } from '../db/db.module.js';
import { mentions } from '../db/schema.js';
import type { MembersService } from '../core/members.service.js';
import type { RelationsService } from '../core/relations.service.js';
import { parseMentions } from './text-parse.js';

/**
 * Resolve @handles in a text to member ids, skipping the author, unknown handles,
 * and anyone blocked either way with the author (brief: no mentions across blocks).
 */
export async function resolveMentions(
  members: MembersService,
  relations: RelationsService,
  authorId: string,
  text: string,
): Promise<string[]> {
  const handles = parseMentions(text);
  if (!handles.length) return [];
  const ids = [...new Set((await members.idsForHandles(handles)).values())].filter((id) => id !== authorId);
  if (!ids.length) return [];
  const blocked = await relations.blockedSet(authorId);
  return ids.filter((id) => !blocked.has(id));
}

/** Replace the stored mentions of a post or comment; returns the newly mentioned ids. */
export async function replaceMentions(
  tx: Db | Tx,
  sourceType: 'post' | 'comment',
  sourceId: string,
  userIds: string[],
): Promise<string[]> {
  const existing = await tx
    .select({ userId: mentions.userId })
    .from(mentions)
    .where(and(eq(mentions.sourceType, sourceType), eq(mentions.sourceId, sourceId)));
  const have = new Set(existing.map((e) => e.userId));
  const removed = [...have].filter((id) => !userIds.includes(id));
  if (removed.length) {
    await tx
      .delete(mentions)
      .where(and(eq(mentions.sourceType, sourceType), eq(mentions.sourceId, sourceId), inArray(mentions.userId, removed)));
  }
  const added = userIds.filter((id) => !have.has(id));
  if (added.length) {
    await tx
      .insert(mentions)
      .values(added.map((userId) => ({ sourceType, sourceId, userId })))
      .onConflictDoNothing();
  }
  return added;
}
