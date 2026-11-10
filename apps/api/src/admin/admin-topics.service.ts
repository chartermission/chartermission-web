import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, ilike, type SQL } from 'drizzle-orm';
import type { AdminTopicCreateInput, AdminTopicRow, AdminTopicsQuery, AdminTopicUpdateInput, Ok } from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import { follows, hashtags } from '../db/schema.js';
import type { AuthContext } from '../core/auth-context.js';
import { AuditService } from '../infra/audit.service.js';
import { QueueService } from '../infra/queue.service.js';
import { Errors } from '../common/errors.js';
import { isUniqueViolation, likePrefix, uuidOr404 } from '../moderation/util.js';

type Row = typeof hashtags.$inferSelect;

const view = (r: Row): AdminTopicRow => ({
  id: r.id,
  tag: r.tag,
  display: r.display,
  description: r.description,
  status: r.status as AdminTopicRow['status'],
  featured: r.featured,
  postCount: r.postCount,
  followerCount: r.followerCount,
  createdAt: r.createdAt.toISOString(),
});

/**
 * Admin console: the topic (hashtag) catalogue. Featured topics are suggested first in onboarding
 * and listed on the Topics page before anyone posts with them; disabled topics leave trending,
 * suggestions and search (posts keep the tag). Pin / suppress stay on the Trending page.
 */
@Injectable()
export class AdminTopicsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly audit: AuditService,
    private readonly queue: QueueService,
  ) {}

  /** GET /admin/topics */
  async list(q: AdminTopicsQuery): Promise<AdminTopicRow[]> {
    const conds: SQL[] = [];
    if (q.status !== 'all') conds.push(eq(hashtags.status, q.status));
    if (q.featured === 'featured') conds.push(eq(hashtags.featured, true));
    const term = q.q?.replace(/^#/, '');
    if (term) conds.push(ilike(hashtags.tag, `%${likePrefix(term.toLowerCase()).slice(0, -1)}%`));
    const rows = await this.db
      .select()
      .from(hashtags)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(hashtags.featured), desc(hashtags.postCount), asc(hashtags.tag))
      .limit(500);
    return rows.map(view);
  }

  /** POST /admin/topics. An existing tag is featured / re-enabled instead of duplicated. */
  async create(ctx: AuthContext, input: AdminTopicCreateInput, ip?: string): Promise<AdminTopicRow> {
    const tag = input.tag.toLowerCase();
    const [existing] = await this.db.select().from(hashtags).where(eq(hashtags.tag, tag)).limit(1);
    let row: Row;
    if (existing) {
      [row] = (await this.db
        .update(hashtags)
        .set({
          status: 'active',
          featured: input.featured || existing.featured,
          description: input.description || existing.description,
          updatedAt: new Date(),
        })
        .where(eq(hashtags.id, existing.id))
        .returning()) as [Row];
    } else {
      try {
        [row] = (await this.db
          .insert(hashtags)
          .values({ tag, display: input.tag, description: input.description || null, featured: input.featured })
          .returning()) as [Row];
      } catch (err) {
        if (isUniqueViolation(err)) throw Errors.conflict('That topic was just added. Reload the list.');
        throw err;
      }
    }
    await this.audit.record({ actorId: ctx.user.id, action: 'topic.added', targetType: 'hashtag', targetId: row.id, after: input, ip });
    return view(row);
  }

  /** PATCH /admin/topics/{id} */
  async update(ctx: AuthContext, rawId: string, input: AdminTopicUpdateInput, ip?: string): Promise<AdminTopicRow> {
    const id = uuidOr404(rawId, 'That topic');
    const [before] = await this.db.select().from(hashtags).where(eq(hashtags.id, id)).limit(1);
    if (!before) throw Errors.notFound('That topic');
    if (input.display && input.display.toLowerCase() !== before.tag) {
      throw Errors.validation({ display: 'You can only change the capitalisation. Add a new topic for a different tag.' });
    }
    const [row] = (await this.db
      .update(hashtags)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(hashtags.id, id))
      .returning()) as [Row];
    const action =
      input.status && input.status !== before.status ? (input.status === 'active' ? 'topic.activated' : 'topic.deactivated') : 'topic.updated';
    await this.audit.record({
      actorId: ctx.user.id,
      action,
      targetType: 'hashtag',
      targetId: id,
      before: { display: before.display, description: before.description, status: before.status, featured: before.featured },
      after: input,
      ip,
    });
    // Trending snapshots are recomputed so a disabled topic drops out straight away.
    if (input.status && input.status !== before.status) await this.queue.add('trending', 'compute', {});
    return view(row);
  }

  /** DELETE /admin/topics/{id}: only topics no post uses; otherwise deactivate. Follows of the tag go too. */
  async remove(ctx: AuthContext, rawId: string, ip?: string): Promise<Ok> {
    const id = uuidOr404(rawId, 'That topic');
    const [row] = await this.db.select().from(hashtags).where(eq(hashtags.id, id)).limit(1);
    if (!row) throw Errors.notFound('That topic');
    if (row.postCount > 0) throw Errors.conflict('Posts use this topic. Deactivate it instead.');
    await this.db.transaction(async (tx) => {
      await tx.delete(follows).where(and(eq(follows.targetType, 'hashtag'), eq(follows.targetId, row.tag)));
      await tx.delete(hashtags).where(eq(hashtags.id, id));
    });
    await this.audit.record({ actorId: ctx.user.id, action: 'topic.removed', targetType: 'hashtag', targetId: id, before: view(row), ip });
    return { ok: true };
  }
}
