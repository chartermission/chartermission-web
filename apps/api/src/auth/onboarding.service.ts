import { Injectable } from '@nestjs/common';
import { and, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { ONBOARDING_STEPS, type OnboardingState, type OnboardingUpdateInput } from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import { hashtags, memberProfiles, postHashtags, posts, trendingSnapshots } from '../db/schema.js';
import type { AuthContext } from '../core/auth-context.js';
import { AnalyticsService } from '../infra/analytics.service.js';
import { AppError, Errors } from '../common/errors.js';
import { ProfilesService } from '../profiles/profiles.service.js';
import { TaxonomyService } from '../profiles/taxonomy.service.js';
import { FollowsService } from '../profiles/follows.service.js';
import { SuggestionsService } from '../profiles/suggestions.service.js';

const DONE = ONBOARDING_STEPS.length;
const HASHTAG_SUGGESTIONS = 12;
const MEMBER_SUGGESTIONS = 8;
const RECENT_DAYS = 7;

/**
 * Onboarding wizard (CM-AUTH-07): about → topics → skills → community. Each step is saved
 * server-side, can be skipped, and the saved step is where the member resumes.
 */
@Injectable()
export class OnboardingService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly profiles: ProfilesService,
    private readonly taxonomy: TaxonomyService,
    private readonly follows: FollowsService,
    private readonly suggestions: SuggestionsService,
    private readonly analytics: AnalyticsService,
  ) {}

  /** GET /me/onboarding */
  async state(userId: string): Promise<OnboardingState> {
    const [profile] = await this.db
      .select({
        step: memberProfiles.onboardingStep,
        completedAt: memberProfiles.onboardingCompletedAt,
        headline: memberProfiles.headline,
        countryCode: memberProfiles.countryCode,
        city: memberProfiles.city,
      })
      .from(memberProfiles)
      .where(eq(memberProfiles.userId, userId));
    if (!profile) throw Errors.notFound('Profile');
    const [interestIds, skillIds, sectorIds, tagKeys, chapterIds, memberIds, hashtagSuggestions, memberSuggestions] =
      await Promise.all([
        this.taxonomy.idsFor('interests', userId),
        this.taxonomy.idsFor('skills', userId),
        this.taxonomy.idsFor('sectors', userId),
        this.follows.followedIds(userId, 'hashtag'),
        this.follows.followedIds(userId, 'chapter'),
        this.follows.followedIds(userId, 'member'),
        this.hashtagSuggestions(),
        this.suggestions.suggest(userId, {
          reasons: ['country', 'sector', 'interest'],
          limit: MEMBER_SUGGESTIONS,
          excludeConnected: false,
        }),
      ]);
    return {
      step: Math.min(profile.step, DONE),
      completed: !!profile.completedAt,
      data: {
        headline: profile.headline,
        countryCode: profile.countryCode,
        city: profile.city,
        interestIds,
        followedHashtags: await this.displayTags(tagKeys),
        skillIds,
        sectorIds,
        followedChapterIds: chapterIds,
        followedMemberIds: memberIds,
      },
      suggestions: { hashtags: hashtagSuggestions, members: memberSuggestions },
    };
  }

  /** PUT /me/onboarding — save (writes the step's fields) or skip, then advance. */
  async update(ctx: AuthContext, input: OnboardingUpdateInput): Promise<OnboardingState> {
    const userId = ctx.user.id;
    const index = ONBOARDING_STEPS.indexOf(input.step);
    if (input.action === 'save') await this.saveStep(userId, input.step, input.data);

    const [current] = await this.db
      .select({ step: memberProfiles.onboardingStep, completedAt: memberProfiles.onboardingCompletedAt })
      .from(memberProfiles)
      .where(eq(memberProfiles.userId, userId));
    if (!current) throw Errors.notFound('Profile');
    const next = Math.min(Math.max(current.step, index + 1), DONE);
    const completing = next >= DONE && !current.completedAt;
    await this.db
      .update(memberProfiles)
      .set({ onboardingStep: next, ...(completing ? { onboardingCompletedAt: new Date() } : {}) })
      .where(eq(memberProfiles.userId, userId));
    if (completing) this.analytics.track('onboarding_completed', userId, ctx.user.countryCode);
    return this.state(userId);
  }

  private async saveStep(userId: string, step: OnboardingUpdateInput['step'], data: OnboardingUpdateInput['data']) {
    switch (step) {
      case 'about':
        await this.profiles.updateBasics(userId, { headline: data.headline, countryCode: data.countryCode, city: data.city });
        return;
      case 'topics': {
        if (data.interestIds) {
          const ids = await this.taxonomy.validate('interests', data.interestIds, 'interestIds');
          await this.taxonomy.replace(this.db, 'interests', userId, ids);
        }
        for (const tag of data.followedHashtags ?? []) {
          await this.follows.follow(userId, { targetType: 'hashtag', targetId: tag });
        }
        return;
      }
      case 'skills': {
        const skillIds = data.skillIds ? await this.taxonomy.validate('skills', data.skillIds, 'skillIds') : undefined;
        const sectorIds = data.sectorIds ? await this.taxonomy.validate('sectors', data.sectorIds, 'sectorIds') : undefined;
        await this.db.transaction(async (tx) => {
          if (skillIds) await this.taxonomy.replace(tx, 'skills', userId, skillIds);
          if (sectorIds) await this.taxonomy.replace(tx, 'sectors', userId, sectorIds);
        });
        return;
      }
      case 'community': {
        const chapterIds = await this.taxonomy.validChapters(data.followedChapterIds ?? [], 'followedChapterIds');
        for (const id of chapterIds) await this.follows.follow(userId, { targetType: 'chapter', targetId: id });
        for (const id of data.followedMemberIds ?? []) {
          // Unknown, hidden or blocked members are skipped silently (the block is never revealed).
          await this.follows.follow(userId, { targetType: 'member', targetId: id }).catch((err: unknown) => {
            if (!(err instanceof AppError) || ![400, 404].includes(err.getStatus())) throw err;
          });
        }
        return;
      }
    }
  }

  /** Hashtags ranked by visible posts in the last 7 days; flagged when in the latest global 24h trending snapshot. */
  private async hashtagSuggestions(): Promise<OnboardingState['suggestions']['hashtags']> {
    const since = new Date(Date.now() - RECENT_DAYS * 86_400_000);
    const recent = sql<number>`count(${posts.id})::int`;
    const rows = await this.db
      .select({ tag: hashtags.tag, display: hashtags.display, posts: recent })
      .from(hashtags)
      .leftJoin(postHashtags, and(eq(postHashtags.hashtagId, hashtags.id), gt(postHashtags.createdAt, since)))
      .leftJoin(
        posts,
        and(
          eq(posts.id, postHashtags.postId),
          isNull(posts.deletedAt),
          eq(posts.moderationState, 'visible'),
          eq(posts.status, 'published'),
        ),
      )
      .groupBy(hashtags.id)
      .orderBy(desc(recent), desc(hashtags.postCount), hashtags.tag)
      .limit(HASHTAG_SUGGESTIONS);
    const [snapshot] = await this.db
      .select({ entries: trendingSnapshots.entries })
      .from(trendingSnapshots)
      .where(and(eq(trendingSnapshots.scopeType, 'global'), eq(trendingSnapshots.window, '24h')))
      .orderBy(desc(trendingSnapshots.computedAt))
      .limit(1);
    const trending = new Set(
      (snapshot?.entries ?? [])
        .filter((e) => e.status === 'trending' || e.status === 'pinned')
        .map((e) => e.tag.toLowerCase()),
    );
    return rows.map((r) => ({ tag: r.display, posts: r.posts, trending: trending.has(r.tag) }));
  }

  private async displayTags(keys: string[]): Promise<string[]> {
    if (keys.length === 0) return [];
    const rows = await this.db.select({ tag: hashtags.tag, display: hashtags.display }).from(hashtags).where(inArray(hashtags.tag, keys));
    const map = new Map(rows.map((r) => [r.tag, r.display]));
    return keys.map((k) => map.get(k) ?? k);
  }
}
