import { Injectable, Logger } from '@nestjs/common';
import { and, asc, desc, eq, ilike, inArray, ne, or, sql, type SQL } from 'drizzle-orm';
import {
  PROFILE_OPTION_KINDS,
  PROFILE_OPTION_NAME_MAX,
  PROFILE_OPTIONS_MAX,
  ProfileOptionKind,
  type BulkResult,
  type CsvImportResult,
  type Ok,
  type ProfileOptionBulkInput,
  type ProfileOptionCounts,
  type ProfileOptionCreateInput,
  type ProfileOptionImportInput,
  type ProfileOptionMergeInput,
  type ProfileOptionMergeResult,
  type ProfileOptionReorderInput,
  type ProfileOptionRow,
  type ProfileOptionsList,
  type ProfileOptionsQuery,
  type ProfileOptionsSummary,
  type ProfileOptionStatus,
  type ProfileOptionUpdateInput,
} from '@chartermission/contracts';
import type { PgTable } from 'drizzle-orm/pg-core';
import { InjectDb, type Db } from '../db/db.module.js';
import type { Tx } from '../db/client.js';
import {
  eventCategories,
  events,
  initiatives,
  interests,
  languages,
  opportunities,
  pageSectors,
  profileInterests,
  profileLanguages,
  profileSectors,
  profileSkills,
  sectors,
  skills,
} from '../db/schema.js';
import { taxonomySlug } from '../db/seed-data.js';
import type { AuthContext } from '../core/auth-context.js';
import { AuditService } from '../infra/audit.service.js';
import { Errors } from '../common/errors.js';
import { runEach } from '../common/bulk.js';
import { isUniqueViolation, likePrefix, uuidOr404 } from '../moderation/util.js';

type OptionTable = typeof sectors;
type OptionRow = OptionTable['$inferSelect'];

/**
 * Something that points at an option: a link table (one row per owner and option, unique together:
 * `owner` is set) or a single column on another table.
 */
type Link = { table: PgTable; item: string; owner?: string; what: string };

type KindDef = {
  table: OptionTable;
  /** "That skill" in messages. */
  noun: string;
  /** The first link is what `usage` counts (members, or events for categories). */
  links: Link[];
};

const KINDS: Record<ProfileOptionKind, KindDef> = {
  skills: { table: skills, noun: 'skill', links: [{ table: profileSkills, item: 'item_id', owner: 'user_id', what: 'members' }] },
  sectors: {
    table: sectors,
    noun: 'sector',
    links: [
      { table: profileSectors, item: 'item_id', owner: 'user_id', what: 'members' },
      { table: pageSectors, item: 'sector_id', owner: 'page_id', what: 'pages' },
      { table: opportunities, item: 'sector_id', what: 'opportunities' },
      { table: initiatives, item: 'sector_id', what: 'initiatives' },
    ],
  },
  interests: { table: interests, noun: 'interest', links: [{ table: profileInterests, item: 'item_id', owner: 'user_id', what: 'members' }] },
  languages: { table: languages, noun: 'language', links: [{ table: profileLanguages, item: 'item_id', owner: 'user_id', what: 'members' }] },
  'event-categories': { table: eventCategories, noun: 'event category', links: [{ table: events, item: 'category_id', what: 'events' }] },
};

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Status words accepted in a spreadsheet (the console shows Shown / Hidden). */
const STATUS_WORDS: Record<string, ProfileOptionStatus> = { active: 'active', shown: 'active', show: 'active', visible: 'active', hidden: 'hidden', hide: 'hidden' };

const tidy = (name: string) => name.trim().replace(/\s+/g, ' ');

function kindDef(kind: string): { kind: ProfileOptionKind; def: KindDef } {
  const parsed = ProfileOptionKind.safeParse(kind);
  if (!parsed.success) throw Errors.notFound('That list');
  return { kind: parsed.data, def: KINDS[parsed.data] };
}

/** Count of rows pointing at `id` through `link`. */
const linkCount = (link: Link, id: SQL | string | OptionTable['id']) =>
  sql<number>`(select count(*)::int from ${link.table} u where u.${sql.identifier(link.item)} = ${id})`;

/**
 * Admin console: Profile options (settings.manage). The option lists members pick on their profile
 * (skills, sectors, interests, languages) and hosts pick for events (event categories). Hidden
 * options leave every picker but stay where they were already chosen; deleting needs an unused
 * option, merging moves everyone to another option first. Every change is audited with its kind.
 */
@Injectable()
export class AdminProfileOptionsService {
  private readonly log = new Logger('ProfileOptions');

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  /** GET /admin/profile-options: counts per kind, for the tabs. */
  async summary(): Promise<ProfileOptionsSummary> {
    const out = {} as ProfileOptionsSummary;
    for (const kind of PROFILE_OPTION_KINDS) out[kind] = await this.counts(KINDS[kind].table);
    return out;
  }

  /** GET /admin/profile-options/{kind} */
  async list(rawKind: string, q: ProfileOptionsQuery): Promise<ProfileOptionsList> {
    const { kind, def } = kindDef(rawKind);
    const t = def.table;
    const conds: SQL[] = [];
    if (q.status !== 'all') conds.push(eq(t.status, q.status));
    if (q.q) {
      const like = `%${likePrefix(q.q).slice(0, -1)}%`;
      conds.push(or(ilike(t.name, like), ilike(t.slug, like))!);
    }
    const usage = linkCount(def.links[0]!, t.id);
    const order =
      q.sort === 'name'
        ? [asc(sql`lower(${t.name})`), asc(t.id)]
        : q.sort === 'usage'
          ? [desc(usage), asc(t.position), asc(sql`lower(${t.name})`)]
          : [asc(t.position), asc(sql`lower(${t.name})`)];
    const rows = await this.db
      .select({ id: t.id, slug: t.slug, name: t.name, position: t.position, status: t.status, createdAt: t.createdAt, usage })
      .from(t)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(...order)
      .limit(PROFILE_OPTIONS_MAX + 1);
    return {
      kind,
      items: rows.slice(0, PROFILE_OPTIONS_MAX).map((r) => ({ ...r, status: r.status as ProfileOptionStatus, createdAt: r.createdAt.toISOString() })),
      counts: await this.counts(t),
      truncated: rows.length > PROFILE_OPTIONS_MAX,
    };
  }

  /** POST /admin/profile-options/{kind} */
  async create(ctx: AuthContext, rawKind: string, input: ProfileOptionCreateInput, ip?: string): Promise<ProfileOptionRow> {
    const { kind, def } = kindDef(rawKind);
    const t = def.table;
    const name = tidy(input.name);
    const slug = input.slug ?? taxonomySlug(name);
    if (!slug) throw Errors.validation({ name: 'Use at least one letter or number' });
    await this.assertFree(def, { name, slug });
    let row: OptionRow;
    try {
      [row] = (await this.db
        .insert(t)
        .values({ name, slug, position: sql`(select coalesce(max(${t.position}), -1) + 1 from ${t})` })
        .returning()) as [OptionRow];
    } catch (err) {
      if (isUniqueViolation(err)) throw Errors.conflict('That option was just added. Reload the list.');
      throw err;
    }
    await this.audit.record({
      actorId: ctx.user.id,
      action: 'profile_option.created',
      targetType: 'profile_option',
      targetId: row.id,
      after: { kind, name, slug },
      ip,
    });
    return this.row(def, row.id);
  }

  /** PATCH /admin/profile-options/{kind}/{id}: rename, change the slug, hide or show. */
  async update(ctx: AuthContext, rawKind: string, rawId: string, input: ProfileOptionUpdateInput, ip?: string): Promise<ProfileOptionRow> {
    const { kind, def } = kindDef(rawKind);
    const t = def.table;
    const before = await this.find(def, rawId);
    const set: Partial<Pick<OptionRow, 'name' | 'slug' | 'status'>> = {};
    if (input.name !== undefined && tidy(input.name) !== before.name) set.name = tidy(input.name);
    if (input.slug !== undefined && input.slug !== before.slug) set.slug = input.slug;
    if (input.status !== undefined && input.status !== before.status) set.status = input.status;
    if (Object.keys(set).length === 0) return this.row(def, before.id);
    await this.assertFree(def, { name: set.name, slug: set.slug }, before.id);
    try {
      await this.db
        .update(t)
        .set({ ...set, updatedAt: new Date() })
        .where(eq(t.id, before.id));
    } catch (err) {
      if (isUniqueViolation(err)) throw Errors.conflict('Another option was just given this slug. Reload the list.');
      throw err;
    }
    await this.audit.record({
      actorId: ctx.user.id,
      action: 'profile_option.updated',
      targetType: 'profile_option',
      targetId: before.id,
      before: { kind, name: before.name, slug: before.slug, status: before.status },
      after: { kind, ...set },
      ip,
    });
    return this.row(def, before.id);
  }

  /** DELETE /admin/profile-options/{kind}/{id}: only an option nobody uses. */
  async remove(ctx: AuthContext, rawKind: string, rawId: string, ip?: string): Promise<Ok> {
    const { kind, def } = kindDef(rawKind);
    const row = await this.find(def, rawId);
    const uses = await this.uses(def, row.id);
    const used = uses.filter((u) => u.count > 0);
    if (used.length) {
      const first = used[0]!;
      const who = first.what === 'members' ? (first.count === 1 ? '1 member has' : `${first.count} members have`) : null;
      throw Errors.conflict(
        who
          ? `${who} this ${def.noun}. Hide it from pickers or merge it into another ${def.noun} instead.`
          : `Some ${used.map((u) => u.what).join(', ')} use this ${def.noun}. Hide it from pickers or merge it into another ${def.noun} instead.`,
      );
    }
    await this.db.delete(def.table).where(eq(def.table.id, row.id));
    await this.audit.record({
      actorId: ctx.user.id,
      action: 'profile_option.deleted',
      targetType: 'profile_option',
      targetId: row.id,
      before: { kind, name: row.name, slug: row.slug, status: row.status },
      ip,
    });
    return { ok: true };
  }

  /**
   * POST /admin/profile-options/{kind}/{id}/merge: everyone who has this option gets `intoId` instead
   * (once: members who already have both keep just the target), then this option is deleted.
   */
  async merge(ctx: AuthContext, rawKind: string, rawId: string, input: ProfileOptionMergeInput, ip?: string): Promise<ProfileOptionMergeResult> {
    const { kind, def } = kindDef(rawKind);
    const from = await this.find(def, rawId);
    const intoId = input.intoId.toLowerCase();
    if (intoId === from.id) throw Errors.validation({ intoId: 'Choose a different option to merge into' });
    const counts = await this.db.transaction(async (tx) => {
      const locked = await tx
        .select({ id: def.table.id })
        .from(def.table)
        .where(inArray(def.table.id, [from.id, intoId]))
        .for('update');
      if (!locked.some((r) => r.id === from.id)) throw Errors.notFound(`That ${def.noun}`);
      if (!locked.some((r) => r.id === intoId)) throw Errors.validation({ intoId: `Choose a ${def.noun} from this list to merge into` });
      const out: Record<string, { moved: number; dropped: number }> = {};
      for (const link of def.links) out[link.what] = await this.moveLinks(tx, link, from.id, intoId);
      await tx.delete(def.table).where(eq(def.table.id, from.id));
      return out;
    });
    const into = await this.row(def, intoId);
    await this.audit.record({
      actorId: ctx.user.id,
      action: 'profile_option.merged',
      targetType: 'profile_option',
      targetId: from.id,
      before: { kind, name: from.name, slug: from.slug, status: from.status },
      after: { kind, intoId, intoName: into.name, moved: counts },
      ip,
    });
    const primary = counts[def.links[0]!.what]!;
    return { into, moved: primary.moved, dropped: primary.dropped };
  }

  /** POST /admin/profile-options/{kind}/reorder: these ids first, in this order; the rest keep their order after them. */
  async reorder(ctx: AuthContext, rawKind: string, input: ProfileOptionReorderInput, ip?: string): Promise<Ok> {
    const { kind, def } = kindDef(rawKind);
    const t = def.table;
    const all = await this.db.select({ id: t.id, position: t.position }).from(t).orderBy(asc(t.position), asc(sql`lower(${t.name})`));
    const known = new Set(all.map((r) => r.id));
    const ids = [...new Set(input.ids.map((id) => id.toLowerCase()))];
    if (!ids.every((id) => known.has(id))) throw Errors.validation({ ids: 'Some of these options no longer exist. Reload the list.' });
    const chosen = new Set(ids);
    const order = [...ids, ...all.filter((r) => !chosen.has(r.id)).map((r) => r.id)];
    await this.applyOrder(def, all, order);
    await this.audit.record({
      actorId: ctx.user.id,
      action: 'profile_option.reordered',
      targetType: 'profile_option',
      after: { kind, by: 'hand', ids },
      ip,
    });
    return { ok: true };
  }

  /** POST /admin/profile-options/{kind}/sort-alphabetically */
  async sortAlphabetically(ctx: AuthContext, rawKind: string, ip?: string): Promise<Ok> {
    const { kind, def } = kindDef(rawKind);
    const t = def.table;
    const all = await this.db.select({ id: t.id, position: t.position, name: t.name }).from(t);
    const order = [...all].sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) || a.id.localeCompare(b.id)).map((r) => r.id);
    await this.applyOrder(def, all, order);
    await this.audit.record({ actorId: ctx.user.id, action: 'profile_option.reordered', targetType: 'profile_option', after: { kind, by: 'name' }, ip });
    return { ok: true };
  }

  /** POST /admin/profile-options/{kind}/bulk: hide, show, delete or merge each id (merge: into intoId). */
  async bulk(ctx: AuthContext, rawKind: string, input: ProfileOptionBulkInput, ip?: string): Promise<BulkResult> {
    const { def } = kindDef(rawKind);
    switch (input.action) {
      case 'hide':
      case 'show': {
        const status = input.action === 'hide' ? 'hidden' : 'active';
        return runEach(input.ids, (id) => this.update(ctx, rawKind, id, { status }, ip), this.log);
      }
      case 'delete':
        return runEach(input.ids, (id) => this.remove(ctx, rawKind, id, ip), this.log);
      case 'merge': {
        const intoId = input.intoId!;
        // The target must exist before anything moves, or every row would fail the same way.
        await this.find(def, intoId).catch(() => {
          throw Errors.validation({ intoId: `Choose a ${def.noun} from this list to merge into` });
        });
        return runEach(input.ids, (id) => this.merge(ctx, rawKind, id, { intoId }, ip), this.log);
      }
    }
  }

  /**
   * POST /admin/profile-options/{kind}/import. Rows match existing options by slug, else by name
   * ignoring case. add creates only the missing ones; upsert also updates name, position and status.
   * Bad rows are reported by spreadsheet row number and skipped. dryRun writes nothing.
   */
  async import(ctx: AuthContext, rawKind: string, input: ProfileOptionImportInput, ip?: string): Promise<CsvImportResult> {
    const { kind, def } = kindDef(rawKind);
    const t = def.table;
    const existing = await this.db.select().from(t);
    const bySlug = new Map(existing.map((r) => [r.slug, r]));
    const byName = new Map(existing.map((r) => [r.name.toLowerCase(), r]));
    let nextPosition = existing.reduce((max, r) => Math.max(max, r.position), -1) + 1;

    const problems: CsvImportResult['problems'] = [];
    const creates: { name: string; slug: string; position: number; status: ProfileOptionStatus }[] = [];
    const updates: { id: string; before: OptionRow; set: Partial<Pick<OptionRow, 'name' | 'position' | 'status'>> }[] = [];
    let unchanged = 0;
    const seenSlug = new Map<string, number>();
    const seenName = new Map<string, number>();
    const seenMatch = new Map<string, number>();

    for (const r of input.rows) {
      const problem = (message: string) => problems.push({ row: r.row, message });
      const name = tidy(r.name ?? '');
      if (!name) {
        problem('Name is missing');
        continue;
      }
      if (name.length > PROFILE_OPTION_NAME_MAX) {
        problem(`Name is longer than ${PROFILE_OPTION_NAME_MAX} characters`);
        continue;
      }
      const statusWord = (r.status ?? '').trim().toLowerCase();
      const status = statusWord ? STATUS_WORDS[statusWord] : undefined;
      if (statusWord && !status) {
        problem('Status must be active or hidden');
        continue;
      }
      const positionText = String(r.position ?? '').trim();
      if (positionText && !/^\d{1,6}$/.test(positionText)) {
        problem('Position must be a whole number, 0 or more');
        continue;
      }
      const position = positionText ? Number(positionText) : undefined;
      const givenSlug = (r.slug ?? '').trim().toLowerCase();
      if (givenSlug && (!SLUG_RE.test(givenSlug) || givenSlug.length > PROFILE_OPTION_NAME_MAX)) {
        problem('Slug can only use lower-case letters, numbers and hyphens');
        continue;
      }
      const slug = givenSlug || taxonomySlug(name);
      if (!slug) {
        problem('Name needs at least one letter or number');
        continue;
      }
      const lower = name.toLowerCase();
      const match = bySlug.get(slug) ?? byName.get(lower);
      const earlier = seenSlug.get(slug) ?? seenName.get(lower) ?? (match ? seenMatch.get(match.id) : undefined);
      if (earlier !== undefined) {
        problem(`Same option as row ${earlier}`);
        continue;
      }
      seenSlug.set(slug, r.row);
      seenName.set(lower, r.row);
      if (match) seenMatch.set(match.id, r.row);

      if (!match) {
        creates.push({ name, slug, position: position ?? nextPosition++, status: status ?? 'active' });
        continue;
      }
      if (input.mode === 'add') {
        unchanged++;
        continue;
      }
      const set: (typeof updates)[number]['set'] = {};
      if (name !== match.name) {
        const other = byName.get(lower);
        if (other && other.id !== match.id) {
          problem(`Another option is already called ${other.name}`);
          continue;
        }
        set.name = name;
      }
      if (position !== undefined && position !== match.position) set.position = position;
      if (status && status !== match.status) set.status = status;
      if (Object.keys(set).length === 0) unchanged++;
      else updates.push({ id: match.id, before: match, set });
    }

    const result: CsvImportResult = { created: creates.length, updated: updates.length, unchanged, problems, dryRun: input.dryRun };
    if (input.dryRun || (creates.length === 0 && updates.length === 0)) return result;

    try {
      await this.db.transaction(async (tx) => {
        if (creates.length) await tx.insert(t).values(creates);
        for (const u of updates) await tx.update(t).set({ ...u.set, updatedAt: new Date() }).where(eq(t.id, u.id));
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw Errors.conflict('The list changed while importing. Reload and try again.');
      throw err;
    }
    await this.audit.record({
      actorId: ctx.user.id,
      action: 'profile_option.imported',
      targetType: 'profile_option',
      after: {
        kind,
        mode: input.mode,
        created: creates.length,
        updated: updates.length,
        unchanged,
        skipped: problems.length,
        names: creates.slice(0, 100).map((c) => c.name),
        changes: updates.slice(0, 100).map((u) => ({ id: u.id, name: u.before.name, ...u.set })),
      },
      ip,
    });
    return result;
  }

  /* -------------------------------- helpers -------------------------------- */

  private async counts(t: OptionTable): Promise<ProfileOptionCounts> {
    const rows = await this.db.select({ status: t.status, n: sql<number>`count(*)::int` }).from(t).groupBy(t.status);
    const out = { all: 0, active: 0, hidden: 0 };
    for (const r of rows) {
      out.all += r.n;
      if (r.status === 'active' || r.status === 'hidden') out[r.status] += r.n;
    }
    return out;
  }

  private async find(def: KindDef, rawId: string): Promise<OptionRow> {
    const id = uuidOr404(rawId, `That ${def.noun}`);
    const [row] = await this.db.select().from(def.table).where(eq(def.table.id, id)).limit(1);
    if (!row) throw Errors.notFound(`That ${def.noun}`);
    return row;
  }

  private async row(def: KindDef, id: string): Promise<ProfileOptionRow> {
    const t = def.table;
    const [r] = await this.db
      .select({ id: t.id, slug: t.slug, name: t.name, position: t.position, status: t.status, createdAt: t.createdAt, usage: linkCount(def.links[0]!, t.id) })
      .from(t)
      .where(eq(t.id, id))
      .limit(1);
    if (!r) throw Errors.notFound(`That ${def.noun}`);
    return { ...r, status: r.status as ProfileOptionStatus, createdAt: r.createdAt.toISOString() };
  }

  /** Names compare ignoring case; slugs are unique. */
  private async assertFree(def: KindDef, v: { name?: string; slug?: string }, exceptId?: string) {
    const t = def.table;
    const fields: Record<string, string> = {};
    const others = exceptId ? ne(t.id, exceptId) : undefined;
    if (v.name !== undefined) {
      const [same] = await this.db
        .select({ name: t.name })
        .from(t)
        .where(and(eq(sql`lower(${t.name})`, v.name.toLowerCase()), others))
        .limit(1);
      if (same) fields.name = `There is already a ${def.noun} called ${same.name}`;
    }
    if (v.slug !== undefined) {
      const [same] = await this.db
        .select({ name: t.name })
        .from(t)
        .where(and(eq(t.slug, v.slug), others))
        .limit(1);
      if (same) fields.slug = `${same.name} already uses this slug`;
    }
    if (Object.keys(fields).length) throw Errors.validation(fields);
  }

  /** How many rows point at the option, per kind of thing. */
  private async uses(def: KindDef, id: string): Promise<{ what: string; count: number }[]> {
    return Promise.all(
      def.links.map(async (link) => {
        const [r] = (await this.db.execute<{ n: number }>(sql`select ${linkCount(link, id)} as n`)).rows;
        return { what: link.what, count: Number(r?.n ?? 0) };
      }),
    );
  }

  /** Points every row at `into` instead of `from`; where the owner already has `into`, the `from` row is dropped. */
  private async moveLinks(tx: Tx, link: Link, from: string, into: string): Promise<{ moved: number; dropped: number }> {
    const item = sql.identifier(link.item);
    let dropped = 0;
    if (link.owner) {
      const owner = sql.identifier(link.owner);
      const res = await tx.execute(
        sql`delete from ${link.table} a using ${link.table} b where a.${item} = ${from} and b.${item} = ${into} and a.${owner} = b.${owner}`,
      );
      dropped = res.rowCount ?? 0;
    }
    const res = await tx.execute(sql`update ${link.table} set ${item} = ${into} where ${item} = ${from}`);
    return { moved: res.rowCount ?? 0, dropped };
  }

  /** Saves positions 0..n in `order`, writing only the rows whose position changes. */
  private async applyOrder(def: KindDef, current: { id: string; position: number }[], order: string[]) {
    const was = new Map(current.map((r) => [r.id, r.position]));
    const changes = order.map((id, position) => ({ id, position })).filter((c) => was.get(c.id) !== c.position);
    if (!changes.length) return;
    const t = def.table;
    await this.db.transaction(async (tx) => {
      for (const c of changes) await tx.update(t).set({ position: c.position, updatedAt: new Date() }).where(eq(t.id, c.id));
    });
  }
}
