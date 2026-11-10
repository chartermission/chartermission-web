import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { InjectDb, type Db } from '../db/db.module.js';
import { platformSettings } from '../db/schema.js';
import {
  CHAPTER_POSTS_DEFAULTS,
  LEARNING_ACCESS_DEFAULTS,
  PAGES_SETTINGS_DEFAULTS,
  type ChapterPostsSettings,
  type LearningAccessRules,
  type MediaSettings,
  type PagesSettings,
  type PolicyVersions,
  type TrendingRules,
} from '@chartermission/contracts';

export const SETTING_DEFAULTS = {
  policy_versions: { terms: '2026-11', privacy: '2026-11', guidelines: '2026-11' } satisfies PolicyVersions,
  trending_rules: {
    minDistinctAuthors: 25,
    maxPostsPerAuthorPerHour: 3,
    baselineDays: 14,
    recomputeMinutes: 5,
  } satisfies TrendingRules,
  /** Charter Center courses (our course ids) every new Ambassador completes during onboarding. */
  ambassador_training: { courseIds: [] as string[] },
  /** Longest uploaded video, in seconds: feed posts and stories (admin console, Media settings). */
  media_limits: { postVideoMaxSeconds: 600, storyVideoMaxSeconds: 60, introVideoMaxSeconds: 300 } satisfies MediaSettings,
  /** What members must do before Learning opens (admin console, E-learning access). */
  learning_access: LEARNING_ACCESS_DEFAULTS as LearningAccessRules,
  /** Who may create pages from the member app (admin console, Pages). */
  pages: PAGES_SETTINGS_DEFAULTS as PagesSettings,
  /** Whether members' posts go straight into a chapter or wait for its team's approval (admin console, Chapters). */
  chapter_posts: CHAPTER_POSTS_DEFAULTS as ChapterPostsSettings,
};

type SettingKey = keyof typeof SETTING_DEFAULTS;

/** Platform settings with defaults; cached for 30 seconds. */
@Injectable()
export class SettingsService {
  private cache = new Map<string, { value: unknown; at: number }>();
  constructor(@InjectDb() private readonly db: Db) {}

  async get<K extends SettingKey>(key: K): Promise<(typeof SETTING_DEFAULTS)[K]> {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < 30_000) return hit.value as (typeof SETTING_DEFAULTS)[K];
    const [row] = await this.db.select().from(platformSettings).where(eq(platformSettings.key, key)).limit(1);
    const value = { ...SETTING_DEFAULTS[key], ...(row?.value as object | undefined) } as (typeof SETTING_DEFAULTS)[K];
    this.cache.set(key, { value, at: Date.now() });
    return value;
  }

  async set<K extends SettingKey>(key: K, value: (typeof SETTING_DEFAULTS)[K], actorId: string | null) {
    await this.db
      .insert(platformSettings)
      .values({ key, value, updatedBy: actorId })
      .onConflictDoUpdate({ target: platformSettings.key, set: { value, updatedBy: actorId, updatedAt: new Date() } });
    this.cache.delete(key);
  }

  /** Drops cached values (tests reset the database underneath a running app). */
  clearCache() {
    this.cache.clear();
  }
}
