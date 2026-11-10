import { Injectable } from '@nestjs/common';
import { and, count, desc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import {
  type AdminLearningMember,
  type LearningAccess,
  type LearningAccessRules,
  type LearningRequirement,
} from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import { connections, learningAccessOverrides, memberProfiles, posts, users } from '../db/schema.js';
import { SettingsService } from '../infra/settings.service.js';
import { ProfilesService } from '../profiles/profiles.service.js';
import { mediaUrl } from '../core/members.service.js';
import { AppError, Errors } from '../common/errors.js';
import { likeContains } from './courses.service.js';
import type { AuthUser } from '../core/auth-context.js';

/** Profile fields shown to members in the "complete your profile" item (photo is its own rule). */
const PROFILE_FIELD_LABELS: Record<string, string> = {
  headline: 'Headline',
  country: 'Country',
  city: 'City',
  bio: 'About',
  organisation: 'Organisation',
  skills: 'Skills',
  sectors: 'Sectors',
  interests: 'Interests',
  languages: 'Languages',
  experience: 'Experience',
};

const SEARCH_LIMIT = 20;

/**
 * E-learning access: Learning opens once a member meets every rule an admin switched on
 * (Settings → E-learning access), unless the gate is off, they are staff, or an admin unlocked them.
 */
@Injectable()
export class LearningAccessService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly settings: SettingsService,
    private readonly profiles: ProfilesService,
  ) {}

  rules(): Promise<LearningAccessRules> {
    return this.settings.get('learning_access');
  }

  /** GET /learning/access */
  async forMember(user: Pick<AuthUser, 'id' | 'isStaff'>): Promise<LearningAccess> {
    const rules = await this.rules();
    if (!rules.enabled) return { unlocked: true, reason: 'open', requirements: [] };
    const [requirements, [override]] = await Promise.all([
      this.requirements(user.id, rules),
      this.db.select({ userId: learningAccessOverrides.userId }).from(learningAccessOverrides).where(eq(learningAccessOverrides.userId, user.id)).limit(1),
    ]);
    const met = requirements.every((r) => r.done);
    const reason = user.isStaff ? 'staff' : override ? 'override' : met ? 'met' : 'locked';
    return { unlocked: reason !== 'locked', reason, requirements };
  }

  /** Throws LEARNING_LOCKED unless the member may use Learning. */
  async assertUnlocked(user: Pick<AuthUser, 'id' | 'isStaff'>): Promise<void> {
    const rules = await this.rules();
    if (!rules.enabled || user.isStaff) return;
    const access = await this.forMember(user);
    if (!access.unlocked) {
      throw new AppError(403, 'LEARNING_LOCKED', 'Complete your profile and start connecting to unlock Learning.');
    }
  }

  /** The switched-on rules with this member's progress. */
  private async requirements(userId: string, rules: LearningAccessRules): Promise<LearningRequirement[]> {
    const [own, chapterList, [postCount], [connectionCount]] = await Promise.all([
      this.profiles.own(userId),
      rules.requireChapter ? this.profiles.followedChapters(userId) : Promise.resolve([]),
      rules.minPosts > 0
        ? this.db
            .select({ n: count() })
            .from(posts)
            .where(
              and(
                eq(posts.authorId, userId),
                isNull(posts.pageId),
                isNull(posts.deletedAt),
                isNull(posts.repostOfId),
                eq(posts.status, 'published'),
                eq(posts.moderationState, 'visible'),
              ),
            )
        : Promise.resolve([{ n: 0 }]),
      rules.minConnections > 0
        ? this.db
            .select({ n: count() })
            .from(connections)
            .where(
              and(
                eq(connections.status, 'accepted'),
                or(eq(connections.requesterId, userId), eq(connections.addresseeId, userId)),
              ),
            )
        : Promise.resolve([{ n: 0 }]),
    ]);

    const out: LearningRequirement[] = [];
    const yesNo = (key: LearningRequirement['key'], label: string, done: boolean, href: string, extra: Partial<LearningRequirement> = {}) =>
      out.push({ key, label, done, current: done ? 1 : 0, target: 1, href, ...extra });

    if (rules.requireProfileInfo) {
      const missing = own.completeness.missing.filter((f) => f !== 'avatar').map((f) => PROFILE_FIELD_LABELS[f] ?? f);
      yesNo('profile_info', 'Fill in your profile', missing.length === 0, '/settings/profile', { missing });
    }
    if (rules.requirePhoto) yesNo('photo', 'Add a profile photo', !!own.avatarUrl, '/settings/profile#basics');
    if (rules.requireCoverPhoto) yesNo('cover_photo', 'Add a cover photo', !!own.coverUrl, '/settings/profile#basics');
    if (rules.requireChapter) yesNo('chapter', 'Join a chapter', chapterList.length > 0, '/chapters');
    if (rules.minPosts > 0) {
      const n = postCount?.n ?? 0;
      out.push({
        key: 'posts',
        label: rules.minPosts === 1 ? 'Share your first post' : `Share ${rules.minPosts} posts`,
        done: n >= rules.minPosts,
        current: Math.min(n, rules.minPosts),
        target: rules.minPosts,
        href: '/feed',
      });
    }
    if (rules.minConnections > 0) {
      const n = connectionCount?.n ?? 0;
      out.push({
        key: 'connections',
        label: `Connect with ${rules.minConnections} ${rules.minConnections === 1 ? 'member' : 'members'}`,
        done: n >= rules.minConnections,
        current: Math.min(n, rules.minConnections),
        target: rules.minConnections,
        href: '/network',
      });
    }
    return out;
  }

  /* ---------- Admin ---------- */

  /** Search members by name, handle or email; with no query, the members who have an override. */
  async adminMembers(q: string | undefined): Promise<AdminLearningMember[]> {
    const base = this.db
      .select({
        id: users.id,
        email: users.email,
        isStaff: users.isStaff,
        name: memberProfiles.displayName,
        handle: memberProfiles.handle,
        avatarFileId: memberProfiles.avatarFileId,
      })
      .from(users)
      .innerJoin(memberProfiles, eq(memberProfiles.userId, users.id));
    const rows = q
      ? await base
          .where(
            and(
              inArray(users.status, ['unverified', 'active', 'suspended']),
              or(
                ilike(memberProfiles.displayName, likeContains(q)),
                ilike(memberProfiles.handle, likeContains(q.replace(/^@/, ''))),
                ilike(users.email, likeContains(q)),
              ),
            ),
          )
          .orderBy(memberProfiles.displayName)
          .limit(SEARCH_LIMIT)
      : await base
          .innerJoin(learningAccessOverrides, eq(learningAccessOverrides.userId, users.id))
          .orderBy(desc(learningAccessOverrides.createdAt))
          .limit(200);
    return Promise.all(rows.map((r) => this.adminView(r)));
  }

  async adminMember(userId: string): Promise<AdminLearningMember> {
    const [row] = await this.db
      .select({
        id: users.id,
        email: users.email,
        isStaff: users.isStaff,
        name: memberProfiles.displayName,
        handle: memberProfiles.handle,
        avatarFileId: memberProfiles.avatarFileId,
      })
      .from(users)
      .innerJoin(memberProfiles, eq(memberProfiles.userId, users.id))
      .where(eq(users.id, userId))
      .limit(1);
    if (!row) throw Errors.notFound('Member');
    return this.adminView(row);
  }

  /** Unlocks Learning for one member. Returns the previous override (for the audit log). */
  async grant(userId: string, note: string | undefined, actorId: string) {
    await this.adminMember(userId);
    const before = await this.overrideRow(userId);
    await this.db
      .insert(learningAccessOverrides)
      .values({ userId, note: note || null, grantedBy: actorId })
      .onConflictDoUpdate({
        target: learningAccessOverrides.userId,
        set: { note: note || null, grantedBy: actorId, createdAt: sql`now()` },
      });
    return before;
  }

  /** Puts the member back under the rules. Returns the removed override, or null. */
  async revoke(userId: string) {
    await this.adminMember(userId);
    const before = await this.overrideRow(userId);
    await this.db.delete(learningAccessOverrides).where(eq(learningAccessOverrides.userId, userId));
    return before;
  }

  private async overrideRow(userId: string) {
    const [row] = await this.db.select().from(learningAccessOverrides).where(eq(learningAccessOverrides.userId, userId)).limit(1);
    return row ?? null;
  }

  private async adminView(r: {
    id: string;
    email: string;
    isStaff: boolean;
    name: string;
    handle: string;
    avatarFileId: string | null;
  }): Promise<AdminLearningMember> {
    const [access, override] = await Promise.all([this.forMember({ id: r.id, isStaff: r.isStaff }), this.overrideRow(r.id)]);
    let grantedBy: string | null = null;
    if (override?.grantedBy) {
      const [g] = await this.db
        .select({ name: memberProfiles.displayName, email: users.email })
        .from(users)
        .leftJoin(memberProfiles, eq(memberProfiles.userId, users.id))
        .where(eq(users.id, override.grantedBy))
        .limit(1);
      grantedBy = g?.name ?? g?.email ?? null;
    }
    return {
      id: r.id,
      name: r.name,
      handle: r.handle,
      email: r.email,
      avatarUrl: mediaUrl(r.avatarFileId),
      access,
      override: override ? { note: override.note, grantedAt: override.createdAt.toISOString(), grantedBy } : null,
    };
  }
}
