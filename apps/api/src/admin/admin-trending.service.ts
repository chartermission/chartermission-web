import { Injectable } from '@nestjs/common';
import { and, desc, eq, gt, isNull, or } from 'drizzle-orm';
import type {
  AdminTrendingQuery,
  AdminTrendingResponse,
  AdminTrendingRow,
  MemberRef,
  TrendingOverrideInput,
  TrendingOverrideView,
  TrendingRules,
} from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import { chapters, countries, hashtags, trendingOverrides, trendingSnapshots } from '../db/schema.js';
import { Errors } from '../common/errors.js';
import type { AuthContext } from '../core/auth-context.js';
import { MembersService } from '../core/members.service.js';
import { AuditService } from '../infra/audit.service.js';
import { QueueService } from '../infra/queue.service.js';
import { SettingsService } from '../infra/settings.service.js';
import { formerMember, ModerationActionsService } from '../moderation/actions.service.js';
import { iso, isUuid, uuidOr404 } from '../moderation/util.js';

type OverrideRow = typeof trendingOverrides.$inferSelect;
type Scope = TrendingOverrideInput['scope'];

const activeOverride = (now: Date) =>
  and(
    isNull(trendingOverrides.revokedAt),
    or(isNull(trendingOverrides.expiresAt), gt(trendingOverrides.expiresAt, now)),
  );

/**
 * Trending controls (Figma admin trending screen): the live ranking with every entry,
 * pin / suppress overrides with a reason, and the rules. The posts team's computation
 * reads trending_overrides and the 'trending_rules' setting; every change here
 * triggers a recompute.
 */
@Injectable()
export class AdminTrendingService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly members: MembersService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly queue: QueueService,
    private readonly actions: ModerationActionsService,
  ) {}

  private async scopeId(scope: Scope, raw: string | undefined): Promise<string> {
    if (scope === 'global') return '';
    if (!raw) throw Errors.validation({ scopeId: scope === 'country' ? 'Choose a country' : 'Choose a chapter' });
    if (scope === 'country') {
      const code = raw.toUpperCase();
      const [c] = await this.db
        .select({ code: countries.code })
        .from(countries)
        .where(eq(countries.code, code))
        .limit(1);
      if (!c) throw Errors.validation({ scopeId: 'Unknown country' });
      return code;
    }
    const cond = isUuid(raw) ? eq(chapters.id, raw) : eq(chapters.slug, raw.toLowerCase());
    const [ch] = await this.db.select({ id: chapters.id }).from(chapters).where(cond).limit(1);
    if (!ch) throw Errors.validation({ scopeId: 'Unknown chapter' });
    return ch.id;
  }

  async view(q: AdminTrendingQuery): Promise<AdminTrendingResponse> {
    const scopeId = await this.scopeId(q.scope, q.scopeId);
    const now = new Date();
    const [snap] = await this.db
      .select()
      .from(trendingSnapshots)
      .where(
        and(
          eq(trendingSnapshots.scopeType, q.scope),
          eq(trendingSnapshots.scopeId, scopeId),
          eq(trendingSnapshots.window, q.window),
        ),
      )
      .orderBy(desc(trendingSnapshots.computedAt), desc(trendingSnapshots.createdAt))
      .limit(1);
    const overrides = await this.db
      .select({ o: trendingOverrides, tag: hashtags.tag, display: hashtags.display })
      .from(trendingOverrides)
      .innerJoin(hashtags, eq(hashtags.id, trendingOverrides.hashtagId))
      .where(
        and(
          // Global overrides apply in every scope (as the trending computation applies them).
          or(
            and(eq(trendingOverrides.scopeType, q.scope), eq(trendingOverrides.scopeId, scopeId)),
            eq(trendingOverrides.scopeType, 'global'),
          ),
          activeOverride(now),
        ),
      )
      .orderBy(desc(trendingOverrides.createdAt));
    const refs = await this.members.refs(overrides.map((r) => r.o.actorId));
    // A scope's own override wins over a global one for the same tag.
    const byTag = new Map<string, (typeof overrides)[number]>();
    for (const r of overrides) {
      const current = byTag.get(r.tag);
      if (!current || (current.o.scopeType === 'global' && r.o.scopeType !== 'global')) byTag.set(r.tag, r);
    }

    const overrideView = (r: (typeof overrides)[number]): AdminTrendingRow['override'] => ({
      id: r.o.id,
      action: r.o.action as 'pin' | 'suppress',
      reason: r.o.reason,
      actor: refs.get(r.o.actorId) ?? formerMember(r.o.actorId),
      createdAt: r.o.createdAt.toISOString(),
      expiresAt: iso(r.o.expiresAt),
    });

    const rows: Omit<AdminTrendingRow, 'rank'>[] = [];
    const seen = new Set<string>();
    for (const e of snap?.entries ?? []) {
      const key = e.tag.toLowerCase();
      seen.add(key);
      const o = byTag.get(key);
      rows.push({
        tag: e.display || e.tag,
        posts: e.posts,
        authors: e.authors,
        velocityPct: Math.round(e.velocityPct),
        status: o ? (o.o.action === 'pin' ? 'pinned' : 'suppressed') : e.status,
        override: o ? overrideView(o) : null,
      });
    }
    // Overrides on topics the last snapshot did not include still need to be visible and revocable.
    for (const [key, o] of byTag) {
      if (seen.has(key)) continue;
      rows.push({
        tag: o.display,
        posts: 0,
        authors: 0,
        velocityPct: 0,
        status: o.o.action === 'pin' ? 'pinned' : 'suppressed',
        override: overrideView(o),
      });
    }
    let rank = 0;
    return {
      computedAt: iso(snap?.computedAt),
      rules: await this.settings.get('trending_rules'),
      rows: rows.map((r) => ({ ...r, rank: r.status === 'trending' ? ++rank : null })),
    };
  }

  /** POST /admin/trending/overrides — one active override per topic and scope; a new one replaces the old. */
  async createOverride(ctx: AuthContext, input: TrendingOverrideInput, ip?: string): Promise<TrendingOverrideView> {
    const tag = input.tag.toLowerCase();
    const [h] = await this.db.select().from(hashtags).where(eq(hashtags.tag, tag)).limit(1);
    if (!h) throw Errors.notFound('That topic');
    const scopeId = await this.scopeId(input.scope, input.scopeId);
    const now = new Date();
    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
    if (expiresAt && expiresAt <= now) throw Errors.validation({ expiresAt: 'Choose a time in the future' });

    const row = await this.db.transaction(async (tx) => {
      const replaced = await this.actions.revokeOverrides(
        tx,
        h.id,
        input.scope,
        scopeId,
        ctx.user.id,
        `Replaced: ${input.reason}`,
        now,
      );
      const [created] = await tx
        .insert(trendingOverrides)
        .values({
          hashtagId: h.id,
          action: input.action,
          scopeType: input.scope,
          scopeId,
          reason: input.reason,
          actorId: ctx.user.id,
          expiresAt,
        })
        .returning();
      await this.audit.record(
        {
          actorId: ctx.user.id,
          action: `trending.${input.action}`,
          targetType: 'hashtag',
          targetId: h.tag,
          before: replaced[0] ? { overrideId: replaced[0].id, action: replaced[0].action } : { override: null },
          after: {
            overrideId: created!.id,
            action: input.action,
            scope: input.scope,
            scopeId: scopeId || null,
            reason: input.reason,
            expiresAt: iso(expiresAt),
          },
          ip,
        },
        tx,
      );
      return created!;
    });
    await this.queue.add('trending', 'compute', {});
    return this.overrideView(row, h.display, (await this.members.ref(ctx.user.id)) ?? formerMember(ctx.user.id));
  }

  /** DELETE /admin/trending/overrides/{id} — unpin or restore, with a reason. */
  async revokeOverride(ctx: AuthContext, id: string, reason: string, ip?: string) {
    const [o] = await this.db
      .select({ o: trendingOverrides, tag: hashtags.tag })
      .from(trendingOverrides)
      .innerJoin(hashtags, eq(hashtags.id, trendingOverrides.hashtagId))
      .where(eq(trendingOverrides.id, uuidOr404(id, 'That override')))
      .limit(1);
    if (!o) throw Errors.notFound('That override');
    const now = new Date();
    if (o.o.revokedAt || (o.o.expiresAt && o.o.expiresAt <= now))
      throw Errors.conflict('This override is no longer active');
    await this.db.transaction(async (tx) => {
      await tx
        .update(trendingOverrides)
        .set({ revokedAt: now, revokedBy: ctx.user.id, revokeReason: reason })
        .where(eq(trendingOverrides.id, o.o.id));
      await this.audit.record(
        {
          actorId: ctx.user.id,
          action: o.o.action === 'pin' ? 'trending.unpin' : 'trending.unsuppress',
          targetType: 'hashtag',
          targetId: o.tag,
          before: { overrideId: o.o.id, action: o.o.action, scope: o.o.scopeType, scopeId: o.o.scopeId || null },
          after: { revoked: true, reason },
          ip,
        },
        tx,
      );
    });
    await this.queue.add('trending', 'compute', {});
    return { ok: true as const };
  }

  /** PUT /admin/trending/rules */
  async updateRules(ctx: AuthContext, rules: TrendingRules, ip?: string): Promise<TrendingRules> {
    const before = await this.settings.get('trending_rules');
    await this.settings.set('trending_rules', rules, ctx.user.id);
    await this.audit.record({
      actorId: ctx.user.id,
      action: 'trending.rules.updated',
      targetType: 'setting',
      targetId: 'trending_rules',
      before,
      after: rules,
      ip,
    });
    await this.queue.add('trending', 'compute', {});
    return this.settings.get('trending_rules');
  }

  private overrideView(o: OverrideRow, tag: string, actor: MemberRef): TrendingOverrideView {
    return {
      id: o.id,
      tag,
      action: o.action as 'pin' | 'suppress',
      scope: o.scopeType as Scope,
      scopeId: o.scopeId || null,
      reason: o.reason,
      actor,
      createdAt: o.createdAt.toISOString(),
      expiresAt: iso(o.expiresAt),
    };
  }
}
