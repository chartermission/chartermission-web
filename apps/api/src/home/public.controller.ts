import { Controller, Get, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import type { PublicOverview } from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import { chapters, courses, events, follows, hashtags, memberProfiles, pages, postHashtags, posts, users } from '../db/schema.js';

const CACHE_MS = 5 * 60_000;

/**
 * Numbers and a few public names for the landing page. Only counts, chapter names, topic tags
 * and published events leave here: nothing about any one member. Cached for five minutes.
 */
@Injectable()
export class PublicOverviewService {
  private cache: { value: PublicOverview; at: number } | null = null;
  constructor(@InjectDb() private readonly db: Db) {}

  async overview(): Promise<PublicOverview> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.value;
    const n = sql<number>`count(*)::int`;
    const active = inArray(users.status, ['active', 'unverified']);
    const [members, memberCountries, chapterCount, courseCount, eventCount, pageCount, topChapters, trending, nextEvents] = await Promise.all([
      this.db.select({ n }).from(users).where(active),
      this.db
        .select({ n: sql<number>`count(distinct ${memberProfiles.countryCode})::int` })
        .from(memberProfiles)
        .innerJoin(users, eq(users.id, memberProfiles.userId))
        .where(active),
      this.db.select({ n }).from(chapters).where(eq(chapters.status, 'active')),
      this.db.select({ n }).from(courses).where(and(isNull(courses.removedAt), eq(courses.hidden, false))),
      this.db.select({ n }).from(events).where(and(eq(events.status, 'published'), gt(events.startsAt, new Date()))),
      this.db.select({ n }).from(pages).where(eq(pages.status, 'active')),
      this.db
        .select({
          slug: chapters.slug,
          name: chapters.name,
          countryCode: chapters.countryCode,
          members: sql<number>`(select count(*)::int from ${follows} f where f.target_type = 'chapter' and f.target_id = ${chapters.id}::text)`,
        })
        .from(chapters)
        .where(eq(chapters.status, 'active'))
        .orderBy(sql`4 desc`, sql`(${chapters.name} ilike '%diaspora%')`, asc(chapters.name))
        .limit(8),
      this.db
        .select({ tag: hashtags.display, posts: sql<number>`count(*)::int` })
        .from(postHashtags)
        .innerJoin(hashtags, eq(hashtags.id, postHashtags.hashtagId))
        .innerJoin(posts, eq(posts.id, postHashtags.postId))
        .where(
          and(
            isNull(posts.deletedAt),
            eq(posts.status, 'published'),
            eq(posts.moderationState, 'visible'),
            sql`${posts.createdAt} > now() - interval '14 days'`,
          ),
        )
        .groupBy(hashtags.id, hashtags.display)
        .orderBy(sql`count(*) desc`, asc(hashtags.display))
        .limit(8),
      this.db
        .select({ slug: events.slug, title: events.title, startsAt: events.startsAt, format: events.format, city: events.venueCity })
        .from(events)
        .where(and(eq(events.status, 'published'), gt(events.startsAt, new Date())))
        .orderBy(desc(events.featured), asc(events.startsAt))
        .limit(3),
    ]);
    const value: PublicOverview = {
      members: members[0]?.n ?? 0,
      countries: memberCountries[0]?.n ?? 0,
      chapters: chapterCount[0]?.n ?? 0,
      courses: courseCount[0]?.n ?? 0,
      upcomingEvents: eventCount[0]?.n ?? 0,
      pages: pageCount[0]?.n ?? 0,
      topChapters,
      trending,
      events: nextEvents.map((e) => ({ slug: e.slug, title: e.title, startsAt: e.startsAt.toISOString(), format: e.format, location: e.city })),
    };
    this.cache = { value, at: Date.now() };
    return value;
  }
}

@Controller('public')
export class PublicController {
  constructor(private readonly service: PublicOverviewService) {}

  /** GET /public/overview: no sign-in needed. */
  @Get('overview')
  overview(): Promise<PublicOverview> {
    return this.service.overview();
  }
}
