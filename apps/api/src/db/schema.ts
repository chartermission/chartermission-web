/*
 * Phase 1 database schema (spec section 5): identity and access, community,
 * notifications, moderation and operations. Conventions: UUID primary keys,
 * created_at / updated_at on every table, deleted_at on user content, status
 * columns as text with check constraints, foreign keys indexed.
 */
import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const id = () => uuid('id').primaryKey().defaultRandom();
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
const ts = (name: string) => timestamp(name, { withTimezone: true });

/* ======================= Taxonomies ======================= */

export const countries = pgTable('countries', {
  code: text('code').primaryKey(),
  name: text('name').notNull(),
  region: text('region').notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

const taxonomy = (name: string) =>
  pgTable(name, {
    id: id(),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    position: integer('position').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  });

export const sectors = taxonomy('sectors');
export const skills = taxonomy('skills');
export const interests = taxonomy('interests');
export const languages = taxonomy('languages');

/** Chapters are a Phase 3 module; Phase 1 needs them for follows, feed filters and onboarding. */
export const chapters = pgTable(
  'chapters',
  {
    id: id(),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    countryCode: text('country_code')
      .notNull()
      .references(() => countries.code),
    status: text('status').notNull().default('active'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [check('chapters_status_ck', sql`${t.status} in ('proposed','active','dormant','closed')`)],
);

/* ======================= Identity and access (5.1) ======================= */

export const users = pgTable(
  'users',
  {
    id: id(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    emailVerifiedAt: ts('email_verified_at'),
    status: text('status').notNull().default('unverified'),
    /** AES-256-GCM encrypted TOTP secret (spec 8.3). */
    mfaSecretEnc: text('mfa_secret_enc'),
    mfaEnabledAt: ts('mfa_enabled_at'),
    lastLoginAt: ts('last_login_at'),
    suspendedUntil: ts('suspended_until'),
    restrictedPostingUntil: ts('restricted_posting_until'),
    restrictedConnectingUntil: ts('restricted_connecting_until'),
    /** Admin-verified member or official account (decision D2: never set by email verification). */
    verifiedAt: ts('verified_at'),
    isStaff: boolean('is_staff').notNull().default(false),
    deactivatedAt: ts('deactivated_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('users_email_lower_uq').on(sql`lower(${t.email})`),
    index('users_status_idx').on(t.status),
    check(
      'users_status_ck',
      sql`${t.status} in ('unverified','active','deactivated','suspended','deletion_pending','deleted')`,
    ),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    audience: text('audience').notNull().default('member'),
    ipHash: text('ip_hash'),
    userAgent: text('user_agent'),
    mfaVerifiedAt: ts('mfa_verified_at'),
    lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
    idleExpiresAt: ts('idle_expires_at').notNull(),
    expiresAt: ts('expires_at').notNull(),
    revokedAt: ts('revoked_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('sessions_user_idx').on(t.userId),
    check('sessions_audience_ck', sql`${t.audience} in ('member','admin')`),
  ],
);

export const authTokens = pgTable(
  'auth_tokens',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    purpose: text('purpose').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: ts('expires_at').notNull(),
    usedAt: ts('used_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('auth_tokens_user_idx').on(t.userId, t.purpose),
    check('auth_tokens_purpose_ck', sql`${t.purpose} in ('verify','reset')`),
  ],
);

/** Append-only consent records (CM-AUTH-06). */
export const consentRecords = pgTable(
  'consent_records',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    policyType: text('policy_type').notNull(),
    policyVersion: text('policy_version').notNull(),
    acceptedAt: ts('accepted_at').notNull().defaultNow(),
    ipHash: text('ip_hash'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('consent_user_idx').on(t.userId),
    check('consent_policy_ck', sql`${t.policyType} in ('terms','privacy','guidelines')`),
  ],
);

export const memberProfiles = pgTable(
  'member_profiles',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    handle: text('handle').notNull(),
    displayName: text('display_name').notNull(),
    headline: text('headline'),
    countryCode: text('country_code').references(() => countries.code),
    city: text('city'),
    bio: text('bio'),
    organisation: text('organisation'),
    website: text('website'),
    links: jsonb('links').$type<{ label: string; url: string }[]>().notNull().default([]),
    avatarFileId: uuid('avatar_file_id'),
    avatarTone: text('avatar_tone').notNull().default('tint'),
    profileVisibility: text('profile_visibility').notNull().default('members'),
    fieldVisibility: jsonb('field_visibility').$type<Record<string, string>>().notNull().default({}),
    discoverable: boolean('discoverable').notNull().default(true),
    findableByEmail: boolean('findable_by_email').notNull().default(false),
    connectionRequestsFrom: text('connection_requests_from').notNull().default('members'),
    onboardingStep: integer('onboarding_step').notNull().default(0),
    onboardingCompletedAt: ts('onboarding_completed_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('member_profiles_handle_uq').on(sql`lower(${t.handle})`),
    index('member_profiles_country_idx').on(t.countryCode),
    check('profile_visibility_ck', sql`${t.profileVisibility} in ('members','public')`),
    check('profile_conn_from_ck', sql`${t.connectionRequestsFrom} in ('members','nobody')`),
  ],
);

export const profileExperiences = pgTable(
  'profile_experiences',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    organisation: text('organisation').notNull(),
    location: text('location'),
    startDate: text('start_date').notNull(),
    endDate: text('end_date'),
    description: text('description'),
    position: integer('position').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('profile_experiences_user_idx').on(t.userId)],
);

const profileJoin = (name: string, refTable: typeof sectors) =>
  pgTable(
    name,
    {
      userId: uuid('user_id')
        .notNull()
        .references(() => users.id, { onDelete: 'cascade' }),
      itemId: uuid('item_id')
        .notNull()
        .references(() => refTable.id, { onDelete: 'cascade' }),
      createdAt: createdAt(),
      updatedAt: updatedAt(),
    },
    (t) => [primaryKey({ columns: [t.userId, t.itemId] }), index(`${name}_item_idx`).on(t.itemId)],
  );

export const profileSkills = profileJoin('profile_skills', skills);
export const profileSectors = profileJoin('profile_sectors', sectors);
export const profileInterests = profileJoin('profile_interests', interests);
export const profileLanguages = profileJoin('profile_languages', languages);

export const roles = pgTable('roles', {
  id: id(),
  key: text('key').notNull().unique(),
  name: text('name').notNull(),
  requiresMfa: boolean('requires_mfa').notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const permissions = pgTable('permissions', {
  key: text('key').primaryKey(),
  description: text('description').notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permissionKey: text('permission_key')
      .notNull()
      .references(() => permissions.key, { onDelete: 'cascade' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permissionKey] })],
);

export const userRoles = pgTable(
  'user_roles',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    scopeType: text('scope_type'),
    scopeId: text('scope_id'),
    grantedBy: uuid('granted_by').references(() => users.id),
    grantedAt: ts('granted_at').notNull().defaultNow(),
    revokedAt: ts('revoked_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('user_roles_uq').on(t.userId, t.roleId, sql`coalesce(${t.scopeType}, '')`, sql`coalesce(${t.scopeId}, '')`),
    index('user_roles_user_idx').on(t.userId),
  ],
);

/** Enforced in every interaction check (5.1). */
export const blocks = pgTable(
  'blocks',
  {
    blockerId: uuid('blocker_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    blockedId: uuid('blocked_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.blockerId, t.blockedId] }), index('blocks_blocked_idx').on(t.blockedId)],
);

/** Muted members or hashtags: hidden from the viewer's feed without the other side knowing. */
export const mutes = pgTable(
  'mutes',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    targetType: text('target_type').notNull(),
    targetId: text('target_id').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.targetType, t.targetId] }),
    check('mutes_type_ck', sql`${t.targetType} in ('member','hashtag')`),
  ],
);

/* ======================= Community (5.2) ======================= */

export const connections = pgTable(
  'connections',
  {
    id: id(),
    requesterId: uuid('requester_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    addresseeId: uuid('addressee_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('pending'),
    note: text('note'),
    respondedAt: ts('responded_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('connections_requester_idx').on(t.requesterId, t.status),
    index('connections_addressee_idx').on(t.addresseeId, t.status),
    /** One open (pending or accepted) relationship per unordered pair. */
    uniqueIndex('connections_open_pair_uq')
      .on(sql`least(${t.requesterId}, ${t.addresseeId})`, sql`greatest(${t.requesterId}, ${t.addresseeId})`)
      .where(sql`${t.status} in ('pending','accepted')`),
    check('connections_status_ck', sql`${t.status} in ('pending','accepted','declined','withdrawn','removed')`),
  ],
);

export const follows = pgTable(
  'follows',
  {
    followerId: uuid('follower_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    targetType: text('target_type').notNull(),
    /** User id, chapter id, or lower-cased hashtag. */
    targetId: text('target_id').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.followerId, t.targetType, t.targetId] }),
    index('follows_target_idx').on(t.targetType, t.targetId),
    check('follows_type_ck', sql`${t.targetType} in ('member','hashtag','chapter','organisation','initiative')`),
  ],
);

export const files = pgTable(
  'files',
  {
    id: id(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    purpose: text('purpose').notNull(),
    storageKey: text('storage_key').notNull(),
    originalName: text('original_name'),
    declaredMime: text('declared_mime').notNull(),
    mime: text('mime').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    sha256: text('sha256'),
    width: integer('width'),
    height: integer('height'),
    scanStatus: text('scan_status').notNull().default('pending'),
    rejectionReason: text('rejection_reason'),
    isPublic: boolean('is_public').notNull().default(false),
    uploadExpiresAt: ts('upload_expires_at'),
    attachedAt: ts('attached_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('files_owner_idx').on(t.ownerId),
    check('files_purpose_ck', sql`${t.purpose} in ('avatar','post_image','post_document')`),
    check('files_scan_ck', sql`${t.scanStatus} in ('awaiting_upload','pending','clean','infected','rejected')`),
  ],
);

export const hashtags = pgTable('hashtags', {
  id: id(),
  /** Lower-cased key used for lookups and follows. */
  tag: text('tag').notNull().unique(),
  /** Display form, from first use (e.g. "AfCFTA"). */
  display: text('display').notNull(),
  description: text('description'),
  postCount: integer('post_count').notNull().default(0),
  followerCount: integer('follower_count').notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const posts = pgTable(
  'posts',
  {
    id: id(),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    body: text('body').notNull().default(''),
    kind: text('kind').notNull().default('standard'),
    visibility: text('visibility').notNull().default('members'),
    chapterId: uuid('chapter_id').references(() => chapters.id),
    /** Author's country at posting time, for country filters and trending scopes. */
    countryCode: text('country_code'),
    repostOfId: uuid('repost_of_id'),
    linkUrl: text('link_url'),
    linkPreview: jsonb('link_preview').$type<{
      url: string;
      domain: string;
      title: string | null;
      description: string | null;
      imageUrl: string | null;
    } | null>(),
    status: text('status').notNull().default('published'),
    moderationState: text('moderation_state').notNull().default('visible'),
    pinnedAt: ts('pinned_at'),
    editedAt: ts('edited_at'),
    deletedAt: ts('deleted_at'),
    reactionCount: integer('reaction_count').notNull().default(0),
    likeCount: integer('like_count').notNull().default(0),
    insightfulCount: integer('insightful_count').notNull().default(0),
    supportCount: integer('support_count').notNull().default(0),
    commentCount: integer('comment_count').notNull().default(0),
    repostCount: integer('repost_count').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('posts_author_idx').on(t.authorId, t.createdAt),
    index('posts_created_idx').on(t.createdAt, t.id),
    index('posts_chapter_idx').on(t.chapterId),
    index('posts_repost_idx').on(t.repostOfId),
    check('posts_kind_ck', sql`${t.kind} in ('standard','announcement')`),
    check('posts_visibility_ck', sql`${t.visibility} in ('members','public')`),
    check('posts_status_ck', sql`${t.status} in ('pending_media','published')`),
    check('posts_mod_ck', sql`${t.moderationState} in ('visible','hidden','removed')`),
  ],
);

export const postAttachments = pgTable(
  'post_attachments',
  {
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    fileId: uuid('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    position: integer('position').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.postId, t.fileId] }), check('post_att_kind_ck', sql`${t.kind} in ('image','document')`)],
);

export const postHashtags = pgTable(
  'post_hashtags',
  {
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    hashtagId: uuid('hashtag_id')
      .notNull()
      .references(() => hashtags.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.postId, t.hashtagId] }), index('post_hashtags_tag_idx').on(t.hashtagId, t.createdAt)],
);

export const mentions = pgTable(
  'mentions',
  {
    sourceType: text('source_type').notNull(),
    sourceId: uuid('source_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.sourceType, t.sourceId, t.userId] }),
    index('mentions_user_idx').on(t.userId),
    check('mentions_source_ck', sql`${t.sourceType} in ('post','comment')`),
  ],
);

export const polls = pgTable('polls', {
  id: id(),
  postId: uuid('post_id')
    .notNull()
    .unique()
    .references(() => posts.id, { onDelete: 'cascade' }),
  question: text('question').notNull(),
  closesAt: ts('closes_at').notNull(),
  totalVotes: integer('total_votes').notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const pollOptions = pgTable(
  'poll_options',
  {
    id: id(),
    pollId: uuid('poll_id')
      .notNull()
      .references(() => polls.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    position: integer('position').notNull(),
    voteCount: integer('vote_count').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('poll_options_poll_idx').on(t.pollId)],
);

export const pollVotes = pgTable(
  'poll_votes',
  {
    pollId: uuid('poll_id')
      .notNull()
      .references(() => polls.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    optionId: uuid('option_id')
      .notNull()
      .references(() => pollOptions.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.pollId, t.userId] })],
);

/** One level of replies (CM-FED-03). */
export const comments = pgTable(
  'comments',
  {
    id: id(),
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id'),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    body: text('body').notNull(),
    moderationState: text('moderation_state').notNull().default('visible'),
    editedAt: ts('edited_at'),
    deletedAt: ts('deleted_at'),
    reactionCount: integer('reaction_count').notNull().default(0),
    replyCount: integer('reply_count').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('comments_post_idx').on(t.postId, t.createdAt),
    index('comments_parent_idx').on(t.parentId, t.createdAt),
    index('comments_author_idx').on(t.authorId),
    check('comments_mod_ck', sql`${t.moderationState} in ('visible','hidden','removed')`),
  ],
);

export const reactions = pgTable(
  'reactions',
  {
    targetType: text('target_type').notNull(),
    targetId: uuid('target_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.targetType, t.targetId, t.userId] }),
    index('reactions_user_idx').on(t.userId),
    check('reactions_type_ck', sql`${t.targetType} in ('post','comment')`),
    check('reactions_kind_ck', sql`${t.kind} in ('like','insightful','support')`),
  ],
);

export const bookmarks = pgTable(
  'bookmarks',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    targetType: text('target_type').notNull(),
    targetId: uuid('target_id').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.targetType, t.targetId] }),
    check('bookmarks_type_ck', sql`${t.targetType} in ('post','opportunity','initiative','event','course')`),
  ],
);

/* ======================= Trending ======================= */

/** Computed every few minutes by the trending worker; the latest row per scope/window is served. */
export const trendingSnapshots = pgTable(
  'trending_snapshots',
  {
    id: id(),
    scopeType: text('scope_type').notNull(),
    scopeId: text('scope_id').notNull().default(''),
    window: text('window').notNull(),
    computedAt: ts('computed_at').notNull().defaultNow(),
    entries: jsonb('entries')
      .$type<
        {
          tag: string;
          display: string;
          posts: number;
          authors: number;
          velocityPct: number;
          status: 'trending' | 'pinned' | 'suppressed' | 'below_threshold';
        }[]
      >()
      .notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('trending_scope_idx').on(t.scopeType, t.scopeId, t.window, t.computedAt)],
);

export const trendingOverrides = pgTable(
  'trending_overrides',
  {
    id: id(),
    hashtagId: uuid('hashtag_id')
      .notNull()
      .references(() => hashtags.id, { onDelete: 'cascade' }),
    action: text('action').notNull(),
    scopeType: text('scope_type').notNull().default('global'),
    scopeId: text('scope_id').notNull().default(''),
    reason: text('reason').notNull(),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => users.id),
    expiresAt: ts('expires_at'),
    revokedAt: ts('revoked_at'),
    revokedBy: uuid('revoked_by').references(() => users.id),
    revokeReason: text('revoke_reason'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [check('trending_override_ck', sql`${t.action} in ('pin','suppress')`)],
);

/** Key/value platform settings (trending rules, policy versions). Changes are audited. */
export const platformSettings = pgTable('platform_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedBy: uuid('updated_by').references(() => users.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/* ======================= Notifications (5.4, 4.13) ======================= */

export const notifications = pgTable(
  'notifications',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    category: text('category').notNull(),
    /** Most recent first; batched notifications carry several actors (CM-NTF-05). */
    actorIds: uuid('actor_ids').array().notNull().default(sql`'{}'::uuid[]`),
    actorCount: integer('actor_count').notNull().default(0),
    objectType: text('object_type'),
    objectId: text('object_id'),
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
    dedupeKey: text('dedupe_key').notNull(),
    readAt: ts('read_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('notifications_user_idx').on(t.userId, t.updatedAt),
    index('notifications_dedupe_idx').on(t.userId, t.dedupeKey, t.updatedAt),
  ],
);

export const notificationPreferences = pgTable(
  'notification_preferences',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    category: text('category').notNull(),
    channel: text('channel').notNull(),
    enabled: boolean('enabled').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.category, t.channel] })],
);

/**
 * Transactional and notification email. Payloads containing links are cleared
 * once sent in production (spec 8.3: tokens never kept in logs).
 */
export const emailOutbox = pgTable(
  'email_outbox',
  {
    id: id(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    toAddress: text('to_address').notNull(),
    template: text('template').notNull(),
    subject: text('subject').notNull(),
    textBody: text('text_body'),
    htmlBody: text('html_body'),
    status: text('status').notNull().default('queued'),
    providerMessageId: text('provider_message_id'),
    error: text('error'),
    sentAt: ts('sent_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('email_outbox_status_idx').on(t.status, t.createdAt),
    check('email_status_ck', sql`${t.status} in ('queued','sent','failed','suppressed')`),
  ],
);

export const emailSuppressions = pgTable('email_suppressions', {
  email: text('email').primaryKey(),
  reason: text('reason').notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/* ======================= Moderation and operations (5.4) ======================= */

export const contentReports = pgTable(
  'content_reports',
  {
    id: id(),
    reporterId: uuid('reporter_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    targetType: text('target_type').notNull(),
    targetId: text('target_id').notNull(),
    /** Owner of the reported content (or the reported member), for author history. */
    targetUserId: uuid('target_user_id').references(() => users.id, { onDelete: 'set null' }),
    reasonCode: text('reason_code').notNull(),
    detail: text('detail'),
    status: text('status').notNull().default('open'),
    priority: text('priority').notNull().default('medium'),
    assignedTo: uuid('assigned_to').references(() => users.id),
    resolvedAt: ts('resolved_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('reports_target_idx').on(t.targetType, t.targetId),
    index('reports_status_idx').on(t.status, t.createdAt),
    index('reports_target_user_idx').on(t.targetUserId),
    uniqueIndex('reports_one_open_per_reporter_uq')
      .on(t.reporterId, t.targetType, t.targetId)
      .where(sql`${t.status} in ('open','in_review')`),
    check('reports_target_ck', sql`${t.targetType} in ('post','comment','member','hashtag')`),
    check(
      'reports_status_ck',
      sql`${t.status} in ('open','in_review','actioned','dismissed','appealed','upheld','overturned')`,
    ),
    check('reports_priority_ck', sql`${t.priority} in ('high','medium','low')`),
  ],
);

export const moderationActions = pgTable(
  'moderation_actions',
  {
    id: id(),
    reportId: uuid('report_id').references(() => contentReports.id, { onDelete: 'set null' }),
    moderatorId: uuid('moderator_id')
      .notNull()
      .references(() => users.id),
    targetType: text('target_type').notNull(),
    targetId: text('target_id').notNull(),
    targetUserId: uuid('target_user_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    reason: text('reason').notNull(),
    policyRef: text('policy_ref'),
    expiresAt: ts('expires_at'),
    revokedAt: ts('revoked_at'),
    revokedBy: uuid('revoked_by').references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('mod_actions_target_idx').on(t.targetType, t.targetId),
    index('mod_actions_target_user_idx').on(t.targetUserId, t.createdAt),
    check(
      'mod_actions_action_ck',
      sql`${t.action} in ('hide','remove','warn','restrict_posting','restrict_connecting','suspend','escalate','dismiss','restore')`,
    ),
  ],
);

export const appeals = pgTable(
  'appeals',
  {
    id: id(),
    actionId: uuid('action_id')
      .notNull()
      .unique()
      .references(() => moderationActions.id, { onDelete: 'cascade' }),
    appellantId: uuid('appellant_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    statement: text('statement').notNull(),
    status: text('status').notNull().default('open'),
    reviewerId: uuid('reviewer_id').references(() => users.id),
    decisionReason: text('decision_reason'),
    decidedAt: ts('decided_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [check('appeals_status_ck', sql`${t.status} in ('open','in_review','upheld','overturned')`)],
);

/** Append-only (an UPDATE/DELETE trigger is added in the migration). */
export const auditLog = pgTable(
  'audit_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: text('target_id'),
    before: jsonb('before'),
    after: jsonb('after'),
    ipHash: text('ip_hash'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('audit_actor_idx').on(t.actorId, t.createdAt),
    index('audit_target_idx').on(t.targetType, t.targetId),
    index('audit_action_idx').on(t.action, t.createdAt),
  ],
);

export const deletionRequests = pgTable(
  'deletion_requests',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    reason: text('reason'),
    status: text('status').notNull().default('pending'),
    handledBy: uuid('handled_by').references(() => users.id),
    requestedAt: ts('requested_at').notNull().defaultNow(),
    completedAt: ts('completed_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [check('deletion_status_ck', sql`${t.status} in ('pending','approved','completed','cancelled')`)],
);

/** First-party analytics, fixed event set (spec 4.16). Pseudonymous member id only. */
export const analyticsEvents = pgTable(
  'analytics_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    name: text('name').notNull(),
    memberPseudoId: text('member_pseudo_id'),
    countryCode: text('country_code'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('analytics_name_idx').on(t.name, t.createdAt)],
);
