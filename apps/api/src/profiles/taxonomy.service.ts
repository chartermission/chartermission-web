import { Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, or } from 'drizzle-orm';
import type { Taxonomies, TaxonomyItem } from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import type { Tx } from '../db/client.js';
import {
  chapters,
  countries,
  interests,
  languages,
  profileInterests,
  profileLanguages,
  profileSectors,
  profileSkills,
  sectors,
  skills,
} from '../db/schema.js';
import { Errors } from '../common/errors.js';

export type TaxKind = 'skills' | 'sectors' | 'interests' | 'languages';
export const TAX_KINDS: TaxKind[] = ['skills', 'sectors', 'interests', 'languages'];

const TABLES = {
  skills: { item: skills, join: profileSkills },
  sectors: { item: sectors, join: profileSectors },
  interests: { item: interests, join: profileInterests },
  languages: { item: languages, join: profileLanguages },
} as const;

export type ProfileTaxonomies = Record<TaxKind, TaxonomyItem[]>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: string) => UUID.test(v);

/** Reference data (skills, sectors, interests, languages, countries, chapters) and profile join tables. */
@Injectable()
export class TaxonomyService {
  constructor(@InjectDb() private readonly db: Db) {}

  /** GET /taxonomies */
  async all(): Promise<Taxonomies> {
    const list = async (kind: TaxKind) =>
      (
        await this.db
          .select({ id: TABLES[kind].item.id, slug: TABLES[kind].item.slug, name: TABLES[kind].item.name })
          .from(TABLES[kind].item)
          .orderBy(asc(TABLES[kind].item.position), asc(TABLES[kind].item.name))
      ).map((r) => ({ ...r }));
    const [countryRows, chapterRows, sectorItems, skillItems, interestItems, languageItems] = await Promise.all([
      this.db.select({ code: countries.code, name: countries.name, region: countries.region }).from(countries).orderBy(asc(countries.name)),
      this.db
        .select({ id: chapters.id, slug: chapters.slug, name: chapters.name, countryCode: chapters.countryCode })
        .from(chapters)
        .where(eq(chapters.status, 'active'))
        .orderBy(asc(chapters.name)),
      list('sectors'),
      list('skills'),
      list('interests'),
      list('languages'),
    ]);
    return {
      countries: countryRows,
      sectors: sectorItems,
      skills: skillItems,
      interests: interestItems,
      languages: languageItems,
      chapters: chapterRows,
    };
  }

  /** Taxonomy items linked to each user, in one query per kind. */
  async forUsers(userIds: string[]): Promise<Map<string, ProfileTaxonomies>> {
    const map = new Map<string, ProfileTaxonomies>();
    for (const id of userIds) map.set(id, { skills: [], sectors: [], interests: [], languages: [] });
    if (userIds.length === 0) return map;
    await Promise.all(
      TAX_KINDS.map(async (kind) => {
        const { item, join } = TABLES[kind];
        const rows = await this.db
          .select({ userId: join.userId, id: item.id, slug: item.slug, name: item.name })
          .from(join)
          .innerJoin(item, eq(item.id, join.itemId))
          .where(inArray(join.userId, userIds))
          .orderBy(asc(item.position), asc(item.name));
        for (const r of rows) map.get(r.userId)![kind].push({ id: r.id, slug: r.slug, name: r.name });
      }),
    );
    return map;
  }

  /** Checks every id exists; throws a field error otherwise. Returns de-duplicated ids. */
  async validate(kind: TaxKind, ids: string[], field: string): Promise<string[]> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return [];
    if (!unique.every(isUuid)) throw Errors.validation({ [field]: 'Choose from the list' });
    const { item } = TABLES[kind];
    const rows = await this.db.select({ id: item.id }).from(item).where(inArray(item.id, unique));
    if (rows.length !== unique.length) throw Errors.validation({ [field]: 'Choose from the list' });
    return unique;
  }

  /** Replace a user's links for one taxonomy kind. */
  async replace(tx: Tx | Db, kind: TaxKind, userId: string, ids: string[]) {
    const { join } = TABLES[kind];
    await tx.delete(join).where(eq(join.userId, userId));
    if (ids.length > 0) await tx.insert(join).values(ids.map((itemId) => ({ userId, itemId }))).onConflictDoNothing();
  }

  async idsFor(kind: TaxKind, userId: string): Promise<string[]> {
    const { join } = TABLES[kind];
    const rows = await this.db.select({ id: join.itemId }).from(join).where(eq(join.userId, userId));
    return rows.map((r) => r.id);
  }

  /** Resolve a filter value given as id or slug. Returns null when unknown. */
  async resolve(kind: TaxKind, value: string): Promise<string | null> {
    const { item } = TABLES[kind];
    const [row] = await this.db
      .select({ id: item.id })
      .from(item)
      .where(isUuid(value) ? or(eq(item.id, value), eq(item.slug, value)) : eq(item.slug, value.toLowerCase()))
      .limit(1);
    return row?.id ?? null;
  }

  async countryExists(code: string): Promise<boolean> {
    const [row] = await this.db.select({ code: countries.code }).from(countries).where(eq(countries.code, code)).limit(1);
    return !!row;
  }

  async countryName(code: string | null): Promise<string | null> {
    if (!code) return null;
    const [row] = await this.db.select({ name: countries.name }).from(countries).where(eq(countries.code, code)).limit(1);
    return row?.name ?? null;
  }

  /** Chapters by id or slug that exist and are active. */
  async validChapters(idsOrSlugs: string[], field: string): Promise<string[]> {
    const unique = [...new Set(idsOrSlugs)];
    if (unique.length === 0) return [];
    const ids = unique.filter(isUuid);
    const slugs = unique.filter((v) => !isUuid(v));
    const rows = await this.db
      .select({ id: chapters.id })
      .from(chapters)
      .where(
        and(
          eq(chapters.status, 'active'),
          or(ids.length ? inArray(chapters.id, ids) : undefined, slugs.length ? inArray(chapters.slug, slugs) : undefined),
        ),
      );
    if (rows.length !== unique.length) throw Errors.validation({ [field]: 'Choose chapters from the list' });
    return rows.map((r) => r.id);
  }
}
