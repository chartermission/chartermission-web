import { Injectable, Logger } from '@nestjs/common';
import { and, asc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import type {
  AdminChapterCreateInput,
  AdminChapterRow,
  AdminChaptersBulkInput,
  AdminChaptersQuery,
  AdminChapterUpdateInput,
  BulkResult,
  Ok,
} from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import { chapters, countries, events, files, follows, hashtags, posts, userRoles, users } from '../db/schema.js';
import { chapterDefaults } from '../chapters/chapter-defaults.js';
import type { AuthContext } from '../core/auth-context.js';
import { mediaUrl } from '../core/members.service.js';
import { AuditService } from '../infra/audit.service.js';
import { Errors } from '../common/errors.js';
import { runEach } from '../common/bulk.js';
import { isUniqueViolation, likePrefix, uuidOr404 } from '../moderation/util.js';

const slugify = (v: string) =>
  v
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);

/** Admin console: chapter catalogue (create, rename, activate/deactivate, pictures, remove). */
@Injectable()
export class AdminChaptersService {
  private readonly log = new Logger(AdminChaptersService.name);

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  /** GET /admin/chapters */
  async list(q: AdminChaptersQuery): Promise<AdminChapterRow[]> {
    const conds: SQL[] = [];
    if (q.status !== 'all') conds.push(eq(chapters.status, q.status));
    if (q.region) conds.push(eq(countries.region, q.region));
    if (q.q) {
      const like = `%${likePrefix(q.q).slice(0, -1)}%`;
      conds.push(or(ilike(chapters.name, like), ilike(chapters.slug, like), ilike(countries.name, like), eq(chapters.countryCode, q.q.toUpperCase()))!);
    }
    return this.rows(conds);
  }

  private async rows(conds: SQL[]): Promise<AdminChapterRow[]> {
    // Members are the people who joined the chapter (follows), counted as the chapter page counts them.
    const followers = sql<number>`(select count(*)::int from ${follows} f join ${users} u on u.id = f.follower_id
      where f.target_type = 'chapter' and f.target_id = ${chapters.id}::text and u.status not in ('deleted', 'deletion_pending', 'deactivated'))`;
    const postCount = sql<number>`(select count(*)::int from ${posts} p where p.chapter_id = ${chapters.id} and p.deleted_at is null)`;
    const rows = await this.db
      .select({
        id: chapters.id,
        slug: chapters.slug,
        name: chapters.name,
        countryCode: chapters.countryCode,
        countryName: countries.name,
        region: countries.region,
        status: chapters.status,
        about: chapters.about,
        hashtag: chapters.hashtag,
        imageFileId: chapters.imageFileId,
        coverFileId: chapters.coverFileId,
        photoUrl: chapters.photoUrl,
        photoCredit: chapters.photoCredit,
        photoCreditUrl: chapters.photoCreditUrl,
        postApproval: sql<'direct' | 'review' | null>`${chapters.postApproval}`,
        pendingPosts: sql<number>`(select count(*)::int from ${posts} p where p.chapter_id = ${chapters.id} and p.status = 'in_review' and p.deleted_at is null)`,
        followers,
        posts: postCount,
        createdAt: chapters.createdAt,
      })
      .from(chapters)
      .innerJoin(countries, eq(countries.code, chapters.countryCode))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(sql`case when ${countries.region} = 'Diaspora' then 1 else 0 end`, asc(chapters.name));
    return rows.map(({ imageFileId, coverFileId, createdAt, ...r }) => ({
      ...r,
      imageUrl: mediaUrl(imageFileId),
      coverUrl: mediaUrl(coverFileId),
      createdAt: createdAt.toISOString(),
    }));
  }

  async row(id: string): Promise<AdminChapterRow> {
    const [row] = await this.rows([eq(chapters.id, id)]);
    if (!row) throw Errors.notFound('That chapter');
    return row;
  }

  /** POST /admin/chapters */
  async create(ctx: AuthContext, input: AdminChapterCreateInput, ip?: string): Promise<AdminChapterRow> {
    const [country] = await this.db
      .select({ code: countries.code, name: countries.name, region: countries.region })
      .from(countries)
      .where(eq(countries.code, input.countryCode))
      .limit(1);
    if (!country) throw Errors.validation({ countryCode: 'Choose a country from the list' });
    // A new chapter starts like the seeded ones: its own hashtag and an About text for its country.
    const defaults = chapterDefaults({ name: input.name, countryCode: country.code, countryName: country.name, region: country.region });
    const slug = input.slug ?? slugify(input.name.replace(/\s+chapter$/i, ''));
    if (!slug) throw Errors.validation({ slug: 'Enter a link name' });
    try {
      const [created] = await this.db
        .insert(chapters)
        .values({ slug, name: input.name, countryCode: input.countryCode, status: input.status, about: defaults.about, hashtag: defaults.hashtag })
        .returning({ id: chapters.id });
      await this.ensureHashtag(defaults.hashtag, defaults.hashtagDescription);
      await this.audit.record({ actorId: ctx.user.id, action: 'chapter.created', targetType: 'chapter', targetId: created!.id, after: { ...input, slug }, ip });
      return this.row(created!.id);
    } catch (err) {
      if (isUniqueViolation(err)) throw Errors.validation({ slug: `A chapter with the link name “${slug}” already exists` });
      throw err;
    }
  }

  /** PATCH /admin/chapters/{id} */
  async update(ctx: AuthContext, rawId: string, input: AdminChapterUpdateInput, ip?: string): Promise<AdminChapterRow> {
    return this.row(await this.apply(ctx, rawId, input, ip));
  }

  /** The change behind PATCH /admin/chapters/{id} (also used by bulk): validates, saves and audits; returns the id. */
  private async apply(ctx: AuthContext, rawId: string, input: AdminChapterUpdateInput, ip?: string): Promise<string> {
    const id = uuidOr404(rawId, 'That chapter');
    const [before] = await this.db.select().from(chapters).where(eq(chapters.id, id)).limit(1);
    if (!before) throw Errors.notFound('That chapter');
    if (input.imageFileId) await this.assertFile(input.imageFileId, 'chapter_image', 'imageFileId');
    if (input.coverFileId) await this.assertFile(input.coverFileId, 'chapter_cover', 'coverFileId');
    if (input.hashtag) await this.ensureHashtag(input.hashtag, `The hashtag of the ${input.name ?? before.name}.`);
    await this.db
      .update(chapters)
      .set({ ...input, ...(input.about !== undefined ? { about: input.about || null } : {}), updatedAt: new Date() })
      .where(eq(chapters.id, id));
    const pick = (o: Record<string, unknown>) => Object.fromEntries(Object.keys(input).map((k) => [k, o[k]]));
    await this.audit.record({
      actorId: ctx.user.id,
      action: input.status && input.status !== before.status ? `chapter.${input.status === 'active' ? 'activated' : 'deactivated'}` : 'chapter.updated',
      targetType: 'chapter',
      targetId: id,
      before: pick(before),
      after: input,
      ip,
    });
    return id;
  }

  /** POST /admin/chapters/bulk: each chapter goes through the single change (same rules, one audit entry each). */
  async bulk(ctx: AuthContext, input: AdminChaptersBulkInput, ip?: string): Promise<BulkResult> {
    const change: Record<AdminChaptersBulkInput['action'], (id: string) => Promise<unknown>> = {
      activate: (id) => this.apply(ctx, id, { status: 'active' }, ip),
      deactivate: (id) => this.apply(ctx, id, { status: 'dormant' }, ip),
      posts_direct: (id) => this.apply(ctx, id, { postApproval: 'direct' }, ip),
      posts_review: (id) => this.apply(ctx, id, { postApproval: 'review' }, ip),
      posts_platform: (id) => this.apply(ctx, id, { postApproval: null }, ip),
      delete: (id) => this.remove(ctx, id, ip),
    };
    return runEach(input.ids, change[input.action], this.log);
  }

  /** The topic behind a chapter's hashtag exists, so it can be followed before anyone has posted with it. */
  private async ensureHashtag(display: string, description: string) {
    await this.db
      .insert(hashtags)
      .values({ tag: display.toLowerCase(), display, description })
      .onConflictDoUpdate({ target: hashtags.tag, set: { description: sql`coalesce(${hashtags.description}, excluded.description)` } });
  }

  /** DELETE /admin/chapters/{id}: only chapters nobody has used yet; otherwise deactivate. */
  async remove(ctx: AuthContext, rawId: string, ip?: string): Promise<Ok> {
    const id = uuidOr404(rawId, 'That chapter');
    const [chapter] = await this.db.select().from(chapters).where(eq(chapters.id, id)).limit(1);
    if (!chapter) throw Errors.notFound('That chapter');
    const [use] = await this.db.execute<{ followers: number; posts: number; events: number; roles: number }>(sql`
      select (select count(*)::int from ${follows} where target_type = 'chapter' and target_id = ${id}) as followers,
             (select count(*)::int from ${posts} where chapter_id = ${id}) as posts,
             (select count(*)::int from ${events} where host_chapter_id = ${id}) as events,
             (select count(*)::int from ${userRoles} where scope_type = 'chapter' and scope_id = ${id}) as roles`).then((r) => r.rows);
    if (use && (use.followers || use.posts || use.events || use.roles)) {
      throw Errors.conflict('This chapter already has members, posts, events or team roles. Deactivate it instead.');
    }
    try {
      await this.db.delete(chapters).where(eq(chapters.id, id));
    } catch {
      throw Errors.conflict('This chapter is linked to other records. Deactivate it instead.');
    }
    await this.audit.record({ actorId: ctx.user.id, action: 'chapter.removed', targetType: 'chapter', targetId: id, before: chapter, ip });
    return { ok: true };
  }

  private async assertFile(fileId: string, purpose: 'chapter_image' | 'chapter_cover', field: string) {
    const [file] = await this.db
      .select({ purpose: files.purpose, status: files.scanStatus })
      .from(files)
      .where(eq(files.id, uuidOr404(fileId, 'That file')))
      .limit(1);
    if (!file || file.purpose !== purpose) throw Errors.validation({ [field]: 'Upload the picture again' });
    if (file.status !== 'clean') throw Errors.validation({ [field]: 'The picture is still being checked. Try again in a moment.' });
  }
}
