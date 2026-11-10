import { Injectable } from '@nestjs/common';
import { and, asc, count, eq, gt, isNull, ne, sql } from 'drizzle-orm';
import type {
  ChapterRef,
  ExperienceItem,
  MemberProfile,
  OwnProfile,
  HandleAvailability,
  PreviewAs,
  PrivacySettingsInput,
  ProfileField,
  Relationship,
  UpdateProfileInput,
} from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import { chapters, connections, files, follows, handleHistory, memberProfiles, posts, profileExperiences, users } from '../db/schema.js';
import type { AuthContext } from '../core/auth-context.js';
import { BadgesService } from '../core/badges.service.js';
import { MembersService, mediaUrl, toneFor } from '../core/members.service.js';
import { RelationsService } from '../core/relations.service.js';
import { AppError, Errors } from '../common/errors.js';
import { HANDLE_CHANGE_DAYS, HANDLE_HOLD_DAYS, RESERVED_HANDLES } from './handles.js';
import { isUniqueViolation } from './pg-error.js';
import { RelationshipService } from './relationship.service.js';
import { isUuid, type ProfileTaxonomies, TaxonomyService } from './taxonomy.service.js';
import { canSeeField, effectiveVisibility, isAdminViewer, type ViewerRelation } from './visibility.js';

/** Statuses whose profiles are gone for everyone but admins. */
const HIDDEN_STATUSES = new Set(['deactivated', 'deletion_pending', 'deleted']);

/** Fields that count towards completeness: non-sensitive only, never contact details (CM-PRF-04). */
const COMPLETENESS_FIELDS = [
  'avatar',
  'headline',
  'country',
  'city',
  'bio',
  'organisation',
  'skills',
  'sectors',
  'interests',
  'languages',
  'experience',
] as const;

const profileColumns = {
  userId: memberProfiles.userId,
  email: users.email,
  status: users.status,
  isStaff: users.isStaff,
  isOfficial: users.isOfficial,
  joinedAt: users.createdAt,
  handle: memberProfiles.handle,
  handleChangedAt: memberProfiles.handleChangedAt,
  displayName: memberProfiles.displayName,
  headline: memberProfiles.headline,
  countryCode: memberProfiles.countryCode,
  city: memberProfiles.city,
  bio: memberProfiles.bio,
  organisation: memberProfiles.organisation,
  website: memberProfiles.website,
  links: memberProfiles.links,
  avatarFileId: memberProfiles.avatarFileId,
  coverFileId: memberProfiles.coverFileId,
  avatarTone: memberProfiles.avatarTone,
  profileVisibility: memberProfiles.profileVisibility,
  fieldVisibility: memberProfiles.fieldVisibility,
  discoverable: memberProfiles.discoverable,
  findableByEmail: memberProfiles.findableByEmail,
  connectionRequestsFrom: memberProfiles.connectionRequestsFrom,
};

export type ProfileRow = {
  userId: string;
  email: string;
  status: string;
  isStaff: boolean;
  isOfficial: boolean;
  joinedAt: Date;
  handle: string;
  handleChangedAt: Date | null;
  displayName: string;
  headline: string | null;
  countryCode: string | null;
  city: string | null;
  bio: string | null;
  organisation: string | null;
  website: string | null;
  links: { label: string; url: string }[];
  avatarFileId: string | null;
  coverFileId: string | null;
  avatarTone: string;
  profileVisibility: string;
  fieldVisibility: Record<string, string>;
  discoverable: boolean;
  findableByEmail: boolean;
  connectionRequestsFrom: string;
};

const PREVIEW_RELATION: Record<PreviewAs, ViewerRelation> = {
  public: 'anonymous',
  member: 'member',
  connection: 'connection',
};

@Injectable()
export class ProfilesService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly members: MembersService,
    private readonly relations: RelationsService,
    private readonly relationships: RelationshipService,
    private readonly taxonomy: TaxonomyService,
    private readonly badges: BadgesService,
  ) {}

  /** Profile row by handle (case-insensitive) or user id. */
  async findRow(handleOrId: string): Promise<ProfileRow | null> {
    const where = isUuid(handleOrId)
      ? eq(memberProfiles.userId, handleOrId)
      : eq(sql`lower(${memberProfiles.handle})`, handleOrId.toLowerCase());
    const [row] = await this.db
      .select(profileColumns)
      .from(memberProfiles)
      .innerJoin(users, eq(users.id, memberProfiles.userId))
      .where(where)
      .limit(1);
    if (row || isUuid(handleOrId)) return row ?? null;
    // A username the member used before: old links keep working (the web app redirects to the new one).
    const [old] = await this.db
      .select({ userId: handleHistory.userId })
      .from(handleHistory)
      .where(eq(sql`lower(${handleHistory.handle})`, handleOrId.toLowerCase()))
      .limit(1);
    return old ? this.findRow(old.userId) : null;
  }

  async rowFor(userId: string): Promise<ProfileRow> {
    const row = await this.findRow(userId);
    if (!row) throw Errors.notFound('Profile');
    return row;
  }

  /**
   * GET /members/{handle} (CM-PRF-02/03). Members-only profiles return 401 to visitors;
   * blocked either way, deactivated or deleted return 404.
   */
  async getMember(handleOrId: string, ctx: AuthContext | undefined): Promise<MemberProfile> {
    const row = await this.findRow(handleOrId);
    const admin = isAdminViewer(ctx);
    if (!row || row.status === 'deleted') throw Errors.notFound('Member');
    if (!admin && HIDDEN_STATUSES.has(row.status)) throw Errors.notFound('Member');
    const viewerId = ctx?.user.id;
    if (!viewerId && row.profileVisibility !== 'public') throw Errors.unauthenticated();
    if (!admin && viewerId && viewerId !== row.userId && (await this.relations.isBlockedEitherWay(viewerId, row.userId))) {
      throw Errors.notFound('Member');
    }
    let relation: ViewerRelation;
    if (admin) relation = 'admin';
    else if (!viewerId) relation = 'anonymous';
    else if (viewerId === row.userId) relation = 'self';
    else relation = (await this.relations.areConnected(viewerId, row.userId)) ? 'connection' : 'member';
    const relationship = await this.relationships.one(viewerId, row.userId);
    return this.build(row, relation, relationship);
  }

  /**
   * The member whose connections or followers are being listed, after the same checks as their
   * profile, plus their own "network" privacy setting (members, connections or only me).
   */
  async networkOwner(handleOrId: string, ctx: AuthContext): Promise<ProfileRow> {
    const row = await this.findRow(handleOrId);
    const admin = isAdminViewer(ctx);
    if (!row || row.status === 'deleted' || (!admin && HIDDEN_STATUSES.has(row.status))) throw Errors.notFound('Member');
    const viewerId = ctx.user.id;
    if (admin || viewerId === row.userId) return row;
    if (await this.relations.isBlockedEitherWay(viewerId, row.userId)) throw Errors.notFound('Member');
    const relation: ViewerRelation = (await this.relations.areConnected(viewerId, row.userId)) ? 'connection' : 'member';
    if (!canSeeField(relation, effectiveVisibility(row.fieldVisibility).network)) {
      throw Errors.forbidden(`${row.displayName} keeps this list private`);
    }
    return row;
  }

  /** GET /me/profile/preview?as= (CM-PRF-05): the owner's profile through another viewer's allow-list. */
  async preview(userId: string, as: PreviewAs): Promise<MemberProfile> {
    const row = await this.rowFor(userId);
    const relationship: Relationship = {
      self: false,
      connection: as === 'connection' ? 'connected' : 'none',
      connectionId: null,
      following: false,
      followsYou: false,
      blocked: false,
      muted: false,
      canConnect: !row.isOfficial,
    };
    return this.build(row, PREVIEW_RELATION[as], relationship);
  }

  /** The per-viewer allow-list serialiser. Hidden fields are omitted, never null. */
  private async build(row: ProfileRow, relation: ViewerRelation, relationship: Relationship): Promise<MemberProfile> {
    const vis = effectiveVisibility(row.fieldVisibility);
    const show = (f: ProfileField) => canSeeField(relation, vis[f]);
    const [ref, tax, experience, chapterList, counts, countryName, badgeMap] = await Promise.all([
      this.members.ref(row.userId),
      this.taxonomy.forUsers([row.userId]).then((m) => m.get(row.userId)!),
      show('experience') ? this.experience(row.userId) : Promise.resolve([] as ExperienceItem[]),
      relation === 'anonymous' ? Promise.resolve([] as ChapterRef[]) : this.followedChapters(row.userId),
      this.counts(row.userId),
      show('location') ? this.taxonomy.countryName(row.countryCode) : Promise.resolve(null),
      this.badges.forUsers([row.userId]),
    ]);
    const out: MemberProfile = {
      ...ref!,
      joinedAt: row.joinedAt.toISOString(),
      chapters: chapterList,
      badges: badgeMap.get(row.userId) ?? [],
      counts,
      relationship,
    };
    const coverUrl = mediaUrl(row.coverFileId);
    if (coverUrl) out.coverUrl = coverUrl;
    if (show('location')) {
      if (row.countryCode) out.country = { code: row.countryCode, name: countryName ?? row.countryCode };
      if (row.city) out.city = row.city;
    }
    if (show('email')) out.email = row.email;
    if (show('bio') && row.bio) out.bio = row.bio;
    if (show('organisation') && row.organisation) out.organisation = row.organisation;
    if (show('website') && row.website) out.website = row.website;
    if (show('links')) out.links = row.links ?? [];
    if (show('skills')) out.skills = tax.skills;
    if (show('sectors')) out.sectors = tax.sectors;
    if (show('interests')) out.interests = tax.interests;
    if (show('languages')) out.languages = tax.languages;
    if (show('experience')) out.experience = experience;
    return out;
  }

  private async experience(userId: string): Promise<ExperienceItem[]> {
    const rows = await this.db
      .select()
      .from(profileExperiences)
      .where(eq(profileExperiences.userId, userId))
      .orderBy(asc(profileExperiences.position), asc(profileExperiences.createdAt));
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      organisation: r.organisation,
      location: r.location,
      startDate: r.startDate,
      endDate: r.endDate,
      description: r.description,
    }));
  }

  async followedChapters(userId: string): Promise<ChapterRef[]> {
    return this.db
      .select({ id: chapters.id, slug: chapters.slug, name: chapters.name, countryCode: chapters.countryCode })
      .from(follows)
      .innerJoin(chapters, sql`${chapters.id}::text = ${follows.targetId}`)
      .where(and(eq(follows.followerId, userId), eq(follows.targetType, 'chapter')))
      .orderBy(asc(chapters.name));
  }

  private async counts(userId: string) {
    const [[conn], [fol], [pst]] = await Promise.all([
      this.db
        .select({ n: count() })
        .from(connections)
        .where(
          and(
            eq(connections.status, 'accepted'),
            sql`(${connections.requesterId} = ${userId} or ${connections.addresseeId} = ${userId})`,
          ),
        ),
      this.db
        .select({ n: count() })
        .from(follows)
        .where(and(eq(follows.targetType, 'member'), eq(follows.targetId, userId))),
      this.db
        .select({ n: count() })
        .from(posts)
        .where(
          and(
            eq(posts.authorId, userId),
            isNull(posts.pageId),
            isNull(posts.deletedAt),
            eq(posts.moderationState, 'visible'),
            eq(posts.status, 'published'),
          ),
        ),
    ]);
    return { connections: conn?.n ?? 0, followers: fol?.n ?? 0, posts: pst?.n ?? 0 };
  }

  /** GET /me/profile */
  async own(userId: string): Promise<OwnProfile> {
    const row = await this.rowFor(userId);
    const [tax, experience] = await Promise.all([
      this.taxonomy.forUsers([userId]).then((m) => m.get(userId)!),
      this.experience(userId),
    ]);
    return {
      handle: row.handle,
      name: row.displayName,
      headline: row.headline,
      avatarUrl: mediaUrl(row.avatarFileId),
      coverUrl: mediaUrl(row.coverFileId),
      tone: (row.avatarTone as OwnProfile['tone']) ?? toneFor(userId),
      countryCode: row.countryCode,
      city: row.city,
      bio: row.bio,
      organisation: row.organisation,
      website: row.website,
      links: row.links ?? [],
      skills: tax.skills,
      sectors: tax.sectors,
      interests: tax.interests,
      languages: tax.languages,
      experience,
      profileVisibility: row.profileVisibility as OwnProfile['profileVisibility'],
      fieldVisibility: effectiveVisibility(row.fieldVisibility),
      handleChangeAvailableAt: handleChangeAvailableAt(row.handleChangedAt)?.toISOString() ?? null,
      discoverable: row.discoverable,
      findableByEmail: row.findableByEmail,
      connectionRequestsFrom: row.connectionRequestsFrom as OwnProfile['connectionRequestsFrom'],
      completeness: completeness(row, tax, experience.length),
    };
  }

  /** PATCH /me/profile */
  async update(userId: string, input: UpdateProfileInput): Promise<OwnProfile> {
    const current = await this.rowFor(userId);
    const set: Partial<typeof memberProfiles.$inferInsert> = {};

    const newHandle = input.handle !== undefined && input.handle !== current.handle.toLowerCase() ? input.handle : null;
    if (newHandle) {
      const wait = handleChangeAvailableAt(current.handleChangedAt);
      if (wait) {
        throw Errors.validation({ handle: `You changed your username recently. You can change it again on ${wait.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}.` });
      }
      const problem = await this.handleProblem(newHandle, userId);
      if (problem === TAKEN) throw handleTaken();
      if (problem) throw Errors.validation({ handle: problem });
      set.handle = newHandle;
      set.handleChangedAt = new Date();
    }
    if (input.name !== undefined) set.displayName = input.name;
    if (input.headline !== undefined) set.headline = input.headline || null;
    if (input.countryCode !== undefined) {
      if (input.countryCode && !(await this.taxonomy.countryExists(input.countryCode))) {
        throw Errors.validation({ countryCode: 'Choose a country from the list' });
      }
      set.countryCode = input.countryCode;
    }
    if (input.city !== undefined) set.city = input.city || null;
    if (input.bio !== undefined) set.bio = input.bio || null;
    if (input.organisation !== undefined) set.organisation = input.organisation || null;
    if (input.website !== undefined) set.website = input.website || null;
    if (input.links !== undefined) set.links = input.links;
    if (input.avatarFileId !== undefined) {
      if (input.avatarFileId) await this.assertAvatar(userId, input.avatarFileId);
      set.avatarFileId = input.avatarFileId;
    }
    if (input.coverFileId !== undefined) {
      if (input.coverFileId) await this.assertOwnImage(userId, input.coverFileId, 'profile_cover', 'coverFileId');
      set.coverFileId = input.coverFileId;
    }

    const taxonomies = {
      skills: input.skillIds !== undefined ? await this.taxonomy.validate('skills', input.skillIds, 'skillIds') : undefined,
      sectors: input.sectorIds !== undefined ? await this.taxonomy.validate('sectors', input.sectorIds, 'sectorIds') : undefined,
      interests:
        input.interestIds !== undefined ? await this.taxonomy.validate('interests', input.interestIds, 'interestIds') : undefined,
      languages:
        input.languageIds !== undefined ? await this.taxonomy.validate('languages', input.languageIds, 'languageIds') : undefined,
    };

    try {
      await this.db.transaction(async (tx) => {
        if (newHandle) {
          // Free the name if it was only held by an expired reservation or by this member's own history.
          await tx.delete(handleHistory).where(eq(sql`lower(${handleHistory.handle})`, newHandle));
          await tx.insert(handleHistory).values({ userId, handle: current.handle.toLowerCase() }).onConflictDoNothing();
        }
        if (Object.keys(set).length > 0) await tx.update(memberProfiles).set(set).where(eq(memberProfiles.userId, userId));
        for (const [kind, ids] of Object.entries(taxonomies) as [keyof ProfileTaxonomies, string[] | undefined][]) {
          if (ids) await this.taxonomy.replace(tx, kind, userId, ids);
        }
        if (input.experience !== undefined) {
          await tx.delete(profileExperiences).where(eq(profileExperiences.userId, userId));
          if (input.experience.length > 0) {
            await tx.insert(profileExperiences).values(
              input.experience.map((e, i) => ({
                userId,
                title: e.title,
                organisation: e.organisation,
                location: e.location ?? null,
                startDate: e.startDate,
                endDate: e.endDate ?? null,
                description: e.description ?? null,
                position: i,
              })),
            );
          }
        }
        for (const fileId of [input.avatarFileId, input.coverFileId]) {
          if (!fileId) continue;
          await tx
            .update(files)
            .set({ attachedAt: new Date() })
            .where(and(eq(files.id, fileId), isNull(files.attachedAt)));
        }
      });
    } catch (err) {
      if (isUniqueViolation(err) && set.handle) throw handleTaken();
      throw err;
    }
    return this.own(userId);
  }

  /** PUT /me/privacy */
  async updatePrivacy(userId: string, input: PrivacySettingsInput): Promise<OwnProfile> {
    const current = await this.rowFor(userId);
    const set: Partial<typeof memberProfiles.$inferInsert> = {};
    if (input.profileVisibility !== undefined) set.profileVisibility = input.profileVisibility;
    if (input.fieldVisibility !== undefined) {
      set.fieldVisibility = { ...effectiveVisibility(current.fieldVisibility), ...input.fieldVisibility };
    }
    if (input.discoverable !== undefined) set.discoverable = input.discoverable;
    if (input.findableByEmail !== undefined) set.findableByEmail = input.findableByEmail;
    if (input.connectionRequestsFrom !== undefined) set.connectionRequestsFrom = input.connectionRequestsFrom;
    if (Object.keys(set).length > 0) await this.db.update(memberProfiles).set(set).where(eq(memberProfiles.userId, userId));
    return this.own(userId);
  }

  /** Profile fields written by onboarding (CM-AUTH-07). */
  async updateBasics(userId: string, data: { headline?: string | null; countryCode?: string | null; city?: string | null }) {
    const set: Partial<typeof memberProfiles.$inferInsert> = {};
    if (data.headline !== undefined) set.headline = data.headline || null;
    if (data.city !== undefined) set.city = data.city || null;
    if (data.countryCode !== undefined) {
      if (data.countryCode && !(await this.taxonomy.countryExists(data.countryCode))) {
        throw Errors.validation({ countryCode: 'Choose a country from the list' });
      }
      set.countryCode = data.countryCode;
    }
    if (Object.keys(set).length > 0) await this.db.update(memberProfiles).set(set).where(eq(memberProfiles.userId, userId));
  }

  /** GET /me/handle-availability?handle= — checked as the member types. */
  async handleAvailability(userId: string, handle: string): Promise<HandleAvailability> {
    const current = await this.rowFor(userId);
    if (handle === current.handle.toLowerCase()) return { handle, available: true, reason: null };
    const reason = await this.handleProblem(handle, userId);
    return { handle, available: !reason, reason };
  }

  /** Why this member can't take the username, or null when they can. */
  private async handleProblem(handle: string, userId: string): Promise<string | null> {
    if (RESERVED_HANDLES.has(handle)) return 'That username is not available';
    const [taken] = await this.db
      .select({ id: memberProfiles.userId })
      .from(memberProfiles)
      .where(and(eq(sql`lower(${memberProfiles.handle})`, handle), ne(memberProfiles.userId, userId)))
      .limit(1);
    if (taken) return TAKEN;
    // Someone else used it recently: held for them so their old links can't be taken over.
    const [held] = await this.db
      .select({ id: handleHistory.id })
      .from(handleHistory)
      .where(
        and(
          eq(sql`lower(${handleHistory.handle})`, handle),
          ne(handleHistory.userId, userId),
          gt(handleHistory.createdAt, new Date(Date.now() - HANDLE_HOLD_DAYS * 86_400_000)),
        ),
      )
      .limit(1);
    return held ? 'That username is not available' : null;
  }

  /** avatarFileId must be the member's own, clean, avatar-purpose upload (CM-PRF-07). */
  private async assertAvatar(userId: string, fileId: string) {
    await this.assertOwnImage(userId, fileId, 'avatar', 'avatarFileId');
  }

  private async assertOwnImage(userId: string, fileId: string, purpose: 'avatar' | 'profile_cover', field: string) {
    const [file] = await this.db
      .select({ ownerId: files.ownerId, purpose: files.purpose, scanStatus: files.scanStatus })
      .from(files)
      .where(eq(files.id, fileId))
      .limit(1);
    if (!file || file.ownerId !== userId || file.purpose !== purpose || file.scanStatus !== 'clean') {
      throw Errors.validation({ [field]: 'Upload a JPEG, PNG or WebP photo first' });
    }
  }
}

const TAKEN = 'That username is taken';

/** When the member may change their username again, or null if they can now. */
function handleChangeAvailableAt(changedAt: Date | null): Date | null {
  if (!changedAt) return null;
  const next = new Date(changedAt.getTime() + HANDLE_CHANGE_DAYS * 86_400_000);
  return next.getTime() > Date.now() ? next : null;
}

function handleTaken() {
  return new AppError(409, 'CONFLICT', 'That handle is taken', { handle: 'That handle is taken' });
}

/** CM-PRF-04: completeness from non-sensitive fields only (no email, website or links). */
export function completeness(row: ProfileRow, tax: ProfileTaxonomies, experienceCount: number) {
  const done: Record<(typeof COMPLETENESS_FIELDS)[number], boolean> = {
    avatar: !!row.avatarFileId,
    headline: !!row.headline,
    country: !!row.countryCode,
    city: !!row.city,
    bio: !!row.bio,
    organisation: !!row.organisation,
    skills: tax.skills.length > 0,
    sectors: tax.sectors.length > 0,
    interests: tax.interests.length > 0,
    languages: tax.languages.length > 0,
    experience: experienceCount > 0,
  };
  const missing = COMPLETENESS_FIELDS.filter((f) => !done[f]);
  return {
    percent: Math.round(((COMPLETENESS_FIELDS.length - missing.length) / COMPLETENESS_FIELDS.length) * 100),
    missing: [...missing],
  };
}
