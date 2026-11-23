import { Injectable, Logger } from '@nestjs/common';
import { and, asc, desc, eq, ilike, inArray, type SQL } from 'drizzle-orm';
import {
  TopicTag,
  type AdminTopicCreateInput,
  type AdminTopicRow,
  type AdminTopicsBulkInput,
  type AdminTopicsImportInput,
  type AdminTopicsQuery,
  type AdminTopicUpdateInput,
  type BulkResult,
  type CsvImportResult,
  type Ok,
} from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import { follows, hashtags } from '../db/schema.js';
import type { AuthContext } from '../core/auth-context.js';
import { AuditService } from '../infra/audit.service.js';
import { QueueService } from '../infra/queue.service.js';
import { Errors } from '../common/errors.js';
import { runEach } from '../common/bulk.js';
import { isUniqueViolation, likePrefix, uuidOr404 } from '../moderation/util.js';

type Row = typeof hashtags.$inferSelect;

const YES = ['yes', 'y', 'true', '1', 'featured'];
const NO = ['no', 'n', 'false', '0', ''];
const STATUS_WORDS: Record<string, 'active' | 'disabled'> = {
  active: 'active',
  inactive: 'disabled',
  disabled: 'disabled',
  deactivated: 'disabled',
};

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
  private readonly log = new Logger(AdminTopicsService.name);

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
  async update(ctx: AuthContext, rawId: string, input: AdminTopicUpdateInput, ip?: string, opts: { recompute?: boolean } = {}): Promise<AdminTopicRow> {
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
    if (input.status && input.status !== before.status && opts.recompute !== false) await this.queue.add('trending', 'compute', {});
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

  /**
   * POST /admin/topics/bulk: feature, unfeature, activate, deactivate or delete several topics. Each one
   * goes through the single-topic change (same rules and audit); trending is recomputed once at the end.
   */
  async bulk(ctx: AuthContext, input: AdminTopicsBulkInput, ip?: string): Promise<BulkResult> {
    const change: Record<AdminTopicsBulkInput['action'], (id: string) => Promise<unknown>> = {
      feature: (id) => this.update(ctx, id, { featured: true }, ip),
      unfeature: (id) => this.update(ctx, id, { featured: false }, ip),
      activate: (id) => this.update(ctx, id, { status: 'active' }, ip, { recompute: false }),
      deactivate: (id) => this.update(ctx, id, { status: 'disabled' }, ip, { recompute: false }),
      delete: (id) => this.remove(ctx, id, ip),
    };
    const result = await runEach(input.ids, change[input.action], this.log);
    if ((input.action === 'activate' || input.action === 'deactivate') && result.done.length) await this.queue.add('trending', 'compute', {});
    return result;
  }

  /**
   * POST /admin/topics/import: add new topics and update existing ones from a spreadsheet. Empty cells
   * leave a topic as it is; new topics start active and not featured unless the row says otherwise.
   * With dryRun nothing is written: the result says what would happen.
   */
  async importCsv(ctx: AuthContext, input: AdminTopicsImportInput, ip?: string): Promise<CsvImportResult> {
    const result: CsvImportResult = { created: 0, updated: 0, unchanged: 0, problems: [], dryRun: input.dryRun };
    type Plan =
      | { kind: 'create'; row: number; tag: string; display: string; description: string | null; featured: boolean; status: 'active' | 'disabled' }
      | { kind: 'update'; row: number; before: Row; set: Partial<Pick<Row, 'display' | 'description' | 'featured' | 'status'>> };
    const parsed: { row: number; tag: string; display: string; description?: string; featured?: boolean; status?: 'active' | 'disabled' }[] = [];
    const seen = new Map<string, number>();
    for (const r of input.rows) {
      const tag = TopicTag.safeParse(r.tag);
      if (!r.tag) {
        result.problems.push({ row: r.row, message: 'Add the topic’s hashtag in the tag column' });
        continue;
      }
      if (!tag.success) {
        result.problems.push({ row: r.row, message: `“${r.tag}”: use 2–50 letters, numbers or underscores` });
        continue;
      }
      const key = tag.data.toLowerCase();
      const earlier = seen.get(key);
      if (earlier) {
        result.problems.push({ row: r.row, message: `#${tag.data} is already in row ${earlier}` });
        continue;
      }
      const featuredWord = (r.featured ?? '').toLowerCase();
      if (featuredWord && !YES.includes(featuredWord) && !NO.includes(featuredWord)) {
        result.problems.push({ row: r.row, message: `Featured must be yes or no, not “${r.featured}”` });
        continue;
      }
      const statusWord = (r.status ?? '').toLowerCase();
      if (statusWord && !STATUS_WORDS[statusWord]) {
        result.problems.push({ row: r.row, message: `Status must be active or inactive, not “${r.status}”` });
        continue;
      }
      if ((r.description ?? '').length > 300) {
        result.problems.push({ row: r.row, message: 'Keep the description to 300 characters' });
        continue;
      }
      seen.set(key, r.row);
      parsed.push({
        row: r.row,
        tag: key,
        display: tag.data,
        description: r.description || undefined,
        featured: featuredWord ? YES.includes(featuredWord) : undefined,
        status: statusWord ? STATUS_WORDS[statusWord] : undefined,
      });
    }

    const existing = new Map<string, Row>();
    const tags = parsed.map((p) => p.tag);
    for (let i = 0; i < tags.length; i += 500) {
      for (const row of await this.db.select().from(hashtags).where(inArray(hashtags.tag, tags.slice(i, i + 500)))) existing.set(row.tag, row);
    }
    const plans: Plan[] = [];
    for (const p of parsed) {
      const before = existing.get(p.tag);
      if (!before) {
        plans.push({ kind: 'create', row: p.row, tag: p.tag, display: p.display, description: p.description ?? null, featured: p.featured ?? false, status: p.status ?? 'active' });
        continue;
      }
      const set: Partial<Pick<Row, 'display' | 'description' | 'featured' | 'status'>> = {};
      if (p.display !== before.display) set.display = p.display;
      if (p.description !== undefined && p.description !== before.description) set.description = p.description;
      if (p.featured !== undefined && p.featured !== before.featured) set.featured = p.featured;
      if (p.status !== undefined && p.status !== before.status) set.status = p.status;
      if (Object.keys(set).length) plans.push({ kind: 'update', row: p.row, before, set });
      else result.unchanged += 1;
    }
    result.created = plans.filter((p) => p.kind === 'create').length;
    result.updated = plans.length - result.created;
    if (input.dryRun || plans.length === 0) return result;

    await this.db.transaction(async (tx) => {
      for (const plan of plans) {
        if (plan.kind === 'create') {
          const [row] = await tx
            .insert(hashtags)
            .values({ tag: plan.tag, display: plan.display, description: plan.description, featured: plan.featured, status: plan.status })
            .onConflictDoNothing()
            .returning({ id: hashtags.id });
          if (!row) {
            result.created -= 1;
            result.problems.push({ row: plan.row, message: `#${plan.display} was just added by someone else. Import the file again to update it.` });
            continue;
          }
          await this.audit.record(
            {
              actorId: ctx.user.id,
              action: 'topic.added',
              targetType: 'hashtag',
              targetId: row.id,
              after: { tag: plan.display, description: plan.description, featured: plan.featured, status: plan.status, source: 'csv' },
              ip,
            },
            tx,
          );
        } else {
          await tx.update(hashtags).set({ ...plan.set, updatedAt: new Date() }).where(eq(hashtags.id, plan.before.id));
          const statusChange = plan.set.status && plan.set.status !== plan.before.status;
          await this.audit.record(
            {
              actorId: ctx.user.id,
              action: statusChange ? (plan.set.status === 'active' ? 'topic.activated' : 'topic.deactivated') : 'topic.updated',
              targetType: 'hashtag',
              targetId: plan.before.id,
              before: Object.fromEntries(Object.keys(plan.set).map((k) => [k, plan.before[k as keyof typeof plan.set]])),
              after: { ...plan.set, source: 'csv' },
              ip,
            },
            tx,
          );
        }
      }
    });
    if (plans.some((p) => p.kind === 'update' && p.set.status) || plans.some((p) => p.kind === 'create' && p.status === 'disabled')) {
      await this.queue.add('trending', 'compute', {});
    }
    return result;
  }
}
