import { Injectable } from '@nestjs/common';
import { and, asc, count, eq, isNull, ne, sql } from 'drizzle-orm';
import type {
  ChapterRef,
  ExperienceItem,
  MemberProfile,
  OwnProfile,
  PreviewAs,
  PrivacySettingsInput,
  ProfileField,
  Relationship,
  UpdateProfileInput,
} from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import { chapters, connections, files, follows, memberProfiles, posts, profileExperiences, users } from '../db/schema.js';
import type { AuthContext } from '../core/auth-context.js';
import { MembersService, mediaUrl, toneFor } from '../core/members.service.js';
import { RelationsService } from '../core/relations.service.js';
import { AppError, Errors } from '../common/errors.js';
import { RESERVED_HANDLES } from './handles.js';
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
  joinedAt: users.createdAt,
  handle: memberProfiles.handle,
  displayName: memberProfiles.displayName,
  headline: memberProfiles.headline,
  countryCode: memberProfiles.countryCode,
  city: memberProfiles.city,
  bio: memberProfiles.bio,
  organisation: memberProfiles.organisation,
  website: memberProfiles.website,
  links: memberProfiles.links,
  avatarFileId: memberProfiles.avatarFileId,
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
  joinedAt: Date;
  handle: string;
  displayName: string;
  headline: string | null;
  countryCode: string | null;
  city: string | null;
  bio: string | null;
  organisation: string | null;
  website: string | null;
  links: { label: string; url: string }[];
  avatarFileId: string | null;
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
    return row ?? null;
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
    };
    return this.build(row, PREVIEW_RELATION[as], relationship);
  }

  /** The per-viewer allow-list serialiser. Hidden fields are omitted, never null. */
  private async build(row: ProfileRow, relation: ViewerRelation, relationship: Relationship): Promise<MemberProfile> {
    const vis = effectiveVisibility(row.fieldVisibility);
    const show = (f: ProfileField) => canSeeField(relation, vis[f]);
    const [ref, tax, experience, chapterList, counts, countryName] = await Promise.all([
      this.members.ref(row.userId),
      this.taxonomy.forUsers([row.userId]).then((m) => m.get(row.userId)!),
      show('experience') ? this.experience(row.userId) : Promise.resolve([] as ExperienceItem[]),
      relation === 'anonymous' ? Promise.resolve([] as ChapterRef[]) : this.followedChapters(row.userId),
      this.counts(row.userId),
      show('location') ? this.taxonomy.countryName(row.countryCode) : Promise.resolve(null),
    ]);
    const out: MemberProfile = {
      ...ref!,
      joinedAt: row.joinedAt.toISOString(),
      chapters: chapterList,
      counts,
      relationship,
    };
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

    if (input.handle !== undefined && input.handle !== current.handle.toLowerCase()) {
      if (RESERVED_HANDLES.has(input.handle)) throw Errors.validation({ handle: 'That handle is not available' });
      await this.assertHandleFree(input.handle, userId);
      set.handle = input.handle;
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
        if (input.avatarFileId) {
          await tx
            .update(files)
            .set({ attachedAt: new Date() })
            .where(and(eq(files.id, input.avatarFileId), isNull(files.attachedAt)));
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

  private async assertHandleFree(handle: string, userId: string) {
    const [taken] = await this.db
      .select({ id: memberProfiles.userId })
      .from(memberProfiles)
      .where(and(eq(sql`lower(${memberProfiles.handle})`, handle), ne(memberProfiles.userId, userId)))
      .limit(1);
    if (taken) throw handleTaken();
  }

  /** avatarFileId must be the member's own, clean, avatar-purpose upload (CM-PRF-07). */
  private async assertAvatar(userId: string, fileId: string) {
    const [file] = await this.db
      .select({ ownerId: files.ownerId, purpose: files.purpose, scanStatus: files.scanStatus })
      .from(files)
      .where(eq(files.id, fileId))
      .limit(1);
    if (!file || file.ownerId !== userId || file.purpose !== 'avatar' || file.scanStatus !== 'clean') {
      throw Errors.validation({ avatarFileId: 'Upload a JPEG, PNG or WebP photo first' });
    }
  }
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
