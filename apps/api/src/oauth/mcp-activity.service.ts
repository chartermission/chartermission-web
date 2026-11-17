import { Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, gt, inArray, lt, or, sql } from 'drizzle-orm';
import {
  MCP_LIMIT_BUCKETS,
  MCP_LIMITS,
  mcpBucketMembers,
  type McpAction,
  type McpActivityQuery,
  type McpActivityView,
  type Page,
} from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import { mcpActions } from '../db/schema.js';
import { decodeCursor, paginate } from '../common/cursor.js';
import { Errors } from '../common/errors.js';
import { MembersService } from '../core/members.service.js';
import { isUuid, tsKey } from '../moderation/util.js';

/** How each allowance reads in the 429 message: "Claude can {verb} at most {n} {noun} an hour for you". */
const LIMIT_WORDING: Record<McpAction, [verb: string, one: string, many: string]> = {
  // The post.create allowance also covers scheduling and publishing drafts (MCP_LIMIT_BUCKETS).
  'post.create': ['publish or schedule', 'post', 'posts'],
  'post.schedule': ['schedule', 'post', 'posts'],
  'draft.publish': ['publish', 'draft', 'drafts'],
  'post.edit': ['edit', 'post', 'posts'],
  'post.delete': ['delete', 'post', 'posts'],
  'draft.save': ['save', 'draft', 'drafts'],
  'comment.create': ['write', 'comment', 'comments'],
  'comment.edit': ['edit', 'comment', 'comments'],
  'comment.delete': ['delete', 'comment', 'comments'],
  'reaction.set': ['add', 'reaction', 'reactions'],
  'reaction.remove': ['remove', 'reaction', 'reactions'],
  'connection.request': ['send', 'connection request', 'connection requests'],
  'connection.accept': ['accept', 'connection request', 'connection requests'],
  follow: ['follow', 'member, chapter, topic or page', 'members, chapters, topics or pages'],
  unfollow: ['unfollow', 'member, chapter, topic or page', 'members, chapters, topics or pages'],
};

/** `bucket` is the action whose allowance is spent (see MCP_LIMIT_BUCKETS). */
export function limitMessage(bucket: McpAction, limit: number, period: 'hour' | 'day'): string {
  const [verb, one, many] = LIMIT_WORDING[bucket];
  return `Claude can ${verb} at most ${limit} ${limit === 1 ? one : many} ${period === 'hour' ? 'an hour' : 'a day'} for you; try again later.`;
}

const HOUR = 3600_000;
const DAY = 24 * HOUR;

type Entry = {
  userId: string;
  grantId: string;
  clientName: string;
  action: McpAction;
};

/** What Claude did for members: the per-action limits, the log, and the activity lists. */
@Injectable()
export class McpActivityService {
  private readonly logger = new Logger('McpActivity');

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly members: MembersService,
  ) {}

  /**
   * For a limited action: reserve a slot before the handler runs, or 429 when the member is at the
   * hourly or daily limit (rolling windows) of the action's allowance. Per member and allowance, an
   * advisory lock serialises count-then-insert, so parallel requests can't all slip under the limit.
   * Returns the reserved row's id (complete() or release() it), or null for unlimited actions.
   */
  async reserve(entry: Entry): Promise<string | null> {
    const bucket = MCP_LIMIT_BUCKETS[entry.action] ?? entry.action;
    const limits = MCP_LIMITS[bucket];
    if (!limits) return null;
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`mcp:${entry.userId}`}), hashtext(${bucket}))`);
      const now = Date.now();
      const hourAgo = new Date(now - HOUR);
      const dayAgo = new Date(now - DAY);
      const [row] = await tx
        .select({
          day: sql<number>`count(*)::int`,
          hour: sql<number>`(count(*) filter (where ${mcpActions.createdAt} > ${hourAgo}))::int`,
          oldestDay: sql<string | null>`min(${mcpActions.createdAt})`,
          oldestHour: sql<string | null>`min(${mcpActions.createdAt}) filter (where ${mcpActions.createdAt} > ${hourAgo})`,
        })
        .from(mcpActions)
        .where(
          and(
            eq(mcpActions.userId, entry.userId),
            inArray(mcpActions.action, mcpBucketMembers(bucket)),
            gt(mcpActions.createdAt, dayAgo),
          ),
        );
      const retryAfter = (oldest: string | null | undefined, windowMs: number) =>
        Math.max(1, Math.ceil(((oldest ? new Date(oldest).getTime() : now) + windowMs - now) / 1000));
      if ((row?.hour ?? 0) >= limits.perHour) {
        throw Errors.rateLimited(retryAfter(row?.oldestHour, HOUR), limitMessage(bucket, limits.perHour, 'hour'));
      }
      if ((row?.day ?? 0) >= limits.perDay) {
        throw Errors.rateLimited(retryAfter(row?.oldestDay, DAY), limitMessage(bucket, limits.perDay, 'day'));
      }
      const [reserved] = await tx
        .insert(mcpActions)
        .values({ ...entry, targetType: null, targetId: null })
        .returning({ id: mcpActions.id });
      return reserved!.id;
    });
  }

  /** The handler succeeded: fill in what the reserved action was about. */
  async complete(id: string, target: { targetType: string | null; targetId: string | null }): Promise<void> {
    try {
      await this.db.update(mcpActions).set(target).where(eq(mcpActions.id, id));
    } catch (err) {
      this.logger.error(`Could not complete action ${id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** The handler failed: give the slot back. */
  async release(id: string): Promise<void> {
    try {
      await this.db.delete(mcpActions).where(eq(mcpActions.id, id));
    } catch (err) {
      this.logger.error(`Could not release action ${id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Log a successful unlimited action. Never throws: a failed log must not fail the member's request. */
  async record(entry: Entry & { targetType: string | null; targetId: string | null }): Promise<void> {
    try {
      await this.db.insert(mcpActions).values(entry);
    } catch (err) {
      this.logger.error(`Could not log ${entry.action}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Newest first. Used by the member (their own) and by admins (any member). */
  async list(userId: string, q: McpActivityQuery): Promise<Page<McpActivityView>> {
    const cur = decodeCursor<{ t: string; id: string }>(q.cursor);
    if (cur && (typeof cur.t !== 'string' || !isUuid(cur.id))) throw Errors.badRequest('Invalid cursor');
    const rows = await this.db
      .select({ row: mcpActions, key: tsKey(mcpActions.createdAt) })
      .from(mcpActions)
      .where(
        and(
          eq(mcpActions.userId, userId),
          cur
            ? or(
                lt(mcpActions.createdAt, sql`${cur.t}::timestamptz`),
                and(eq(mcpActions.createdAt, sql`${cur.t}::timestamptz`), lt(mcpActions.id, cur.id)),
              )
            : undefined,
        ),
      )
      .orderBy(desc(mcpActions.createdAt), desc(mcpActions.id))
      .limit(q.limit + 1);
    const page = paginate(rows, q.limit, (r) => ({ t: r.key, id: r.row.id }));
    const hrefs = await this.memberHrefs(
      page.items.filter((r) => r.row.targetType === 'member' && r.row.targetId).map((r) => r.row.targetId!),
    );
    return {
      nextCursor: page.nextCursor,
      items: page.items.map(({ row }) => ({
        id: row.id,
        action: row.action as McpAction,
        clientName: row.clientName,
        targetType: row.targetType,
        targetId: row.targetId,
        href:
          row.targetType === 'post' && row.targetId
            ? `/posts/${row.targetId}`
            : row.targetType === 'member' && row.targetId
              ? (hrefs.get(row.targetId.replace(/^@/, '').toLowerCase()) ?? null)
              : null,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }

  /** Profile links for member targets, logged by id or by @handle. Former members get none. */
  private async memberHrefs(targets: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const ids = targets.filter((t) => isUuid(t));
    const handles = targets.filter((t) => !isUuid(t)).map((h) => h.replace(/^@/, '').toLowerCase());
    const refs = await this.members.refs(ids);
    for (const [id, ref] of refs) if (ref.handle !== 'deleted-member') out.set(id.toLowerCase(), `/${ref.handle}`);
    if (handles.length) {
      const byHandle = await this.members.idsForHandles(handles);
      const handleRefs = await this.members.refs(byHandle.values());
      for (const [handle, id] of byHandle) {
        const ref = handleRefs.get(id);
        if (ref && ref.handle !== 'deleted-member') out.set(handle, `/${ref.handle}`);
      }
    }
    return out;
  }
}
