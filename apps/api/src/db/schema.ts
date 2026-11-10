/*
 * Phase 1 database schema (spec section 5): identity and access, community,
 * notifications, moderation and operations. Conventions: UUID primary keys,
 * created_at / updated_at on every table, deleted_at on user content, status
 * columns as text with check constraints, foreign keys indexed.
 */
import { sql } from 'drizzle-orm';
import {
  bigserial,
  type AnyPgColumn,
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
    /** Short About text, edited by the chapter's Ambassadors and Chapter Leads. */
    about: text('about'),
    /** Custom display picture (a chapter_image upload); null shows the generated brand avatar. */
    imageFileId: uuid('image_file_id').references((): AnyPgColumn => files.id, { onDelete: 'set null' }),
    /** Custom cover banner for the chapter page (a chapter_cover upload); null shows the generated cover. */
    coverFileId: uuid('cover_file_id').references((): AnyPgColumn => files.id, { onDelete: 'set null' }),
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
    /** Wide banner at the top of the profile (profile_cover upload). */
    coverFileId: uuid('cover_file_id'),
    avatarTone: text('avatar_tone').notNull().default('tint'),
    profileVisibility: text('profile_visibility').notNull().default('members'),
    fieldVisibility: jsonb('field_visibility').$type<Record<string, string>>().notNull().default({}),
    discoverable: boolean('discoverable').notNull().default(true),
    findableByEmail: boolean('findable_by_email').notNull().default(false),
    connectionRequestsFrom: text('connection_requests_from').notNull().default('members'),
    onboardingStep: integer('onboarding_step').notNull().default(0),
    onboardingCompletedAt: ts('onboarding_completed_at'),
    /** Home feed visits (GET /home/welcome): the current visit and the one before it. */
    homeSeenAt: ts('home_seen_at'),
    homePrevSeenAt: ts('home_prev_seen_at'),
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
    /** Videos: length after processing, and the storage key of the still frame (poster). */
    durationMs: integer('duration_ms'),
    posterKey: text('poster_key'),
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
    check('files_purpose_ck', sql`${t.purpose} in ('avatar','profile_cover','post_image','post_document','post_video','event_cover','story_image','story_video','chapter_image','chapter_cover')`),
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
  /** active | disabled. Disabled topics leave trending, suggestions and search; posts keep the tag. */
  status: text('status').notNull().default('active'),
  /** Curated by admins: suggested first in onboarding and on the Topics page. */
  featured: boolean('featured').notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [check('hashtags_status_ck', sql`${t.status} in ('active','disabled')`)]);

export const posts = pgTable(
  'posts',
  {
    id: id(),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    body: text('body').notNull().default(''),
    kind: text('kind').notNull().default('standard'),
    /** standard | question | celebration | request | article (contracts PostType). */
    type: text('type').notNull().default('standard'),
    /** Type-specific fields: celebration, request or article details (validated by contracts). */
    details: jsonb('details').$type<Record<string, unknown> | null>(),
    /** Questions: the comment the author marked as the best answer. */
    acceptedCommentId: uuid('accepted_comment_id'),
    /** Requests: closed by the author. */
    closedAt: ts('closed_at'),
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
    index('posts_type_idx').on(t.type, t.createdAt),
    check('posts_kind_ck', sql`${t.kind} in ('standard','announcement')`),
    check('posts_type_ck', sql`${t.type} in ('standard','question','celebration','request','article')`),
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
    /** Image description for screen readers. */
    alt: text('alt'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.postId, t.fileId] }), check('post_att_kind_ck', sql`${t.kind} in ('image','document','video')`)],
);

/** "I can help" offers on request ("Looking for…") posts. */
export const postHelpOffers = pgTable(
  'post_help_offers',
  {
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    note: text('note').notNull().default(''),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.postId, t.userId] }), index('post_help_offers_user_idx').on(t.userId)],
);

/**
 * Composer drafts and scheduled posts. The payload is the composer state
 * (contracts DraftPayload); publishing runs it through the normal post creation,
 * so hashtags, mentions, polls and notifications only happen once it is live.
 */
export const postDrafts = pgTable(
  'post_drafts',
  {
    id: id(),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    status: text('status').notNull().default('draft'),
    scheduledFor: ts('scheduled_for'),
    lastError: text('last_error'),
    publishedPostId: uuid('published_post_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('post_drafts_author_idx').on(t.authorId, t.status, t.updatedAt),
    index('post_drafts_due_idx').on(t.status, t.scheduledFor),
    check('post_drafts_status_ck', sql`${t.status} in ('draft','scheduled','publishing','failed')`),
  ],
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
    check('reports_target_ck', sql`${t.targetType} in ('post','comment','member','hashtag','story','opportunity')`),
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
    /** Id of the thing acted on, for events that define one (event id, course id). */
    subjectId: text('subject_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('analytics_name_idx').on(t.name, t.createdAt), index('analytics_subject_idx').on(t.name, t.subjectId)],
);

/* ======================= Events (spec 4.9, migration 0004) ======================= */

/** Reference values for event filters and the create form (seeded: Conference, Workshop …). */
export const eventCategories = taxonomy('event_categories');

/** One agenda entry, stored in events.agenda (UTC ISO strings). */
export type EventAgendaRow = {
  startsAt: string;
  endsAt: string | null;
  title: string;
  description: string | null;
  speakerNames: string[];
};

/**
 * An event. Host: exactly one of host_member_id / host_chapter_id / host_organisation_id matches
 * host_type (organisations have no table yet, so that column has no foreign key and the API does
 * not create organisation hosts). Online access URL is AES-256-GCM encrypted (common/crypto.ts).
 * registered_count / waitlist_count are maintained in the same transaction as registration
 * changes, under SELECT … FOR UPDATE on this row (capacity enforcement).
 * country_code = venue country, or the host chapter's country for online-only events (filters).
 */
export const events = pgTable(
  'events',
  {
    id: id(),
    slug: text('slug').notNull().unique(),
    title: text('title').notNull(),
    summary: text('summary').notNull(),
    description: text('description').notNull().default(''),
    categoryId: uuid('category_id').references(() => eventCategories.id, { onDelete: 'set null' }),
    format: text('format').notNull(),
    status: text('status').notNull().default('draft'),
    hostType: text('host_type').notNull(),
    hostMemberId: uuid('host_member_id').references(() => users.id, { onDelete: 'cascade' }),
    hostChapterId: uuid('host_chapter_id').references(() => chapters.id),
    /** Future organisations table; no foreign key yet. */
    hostOrganisationId: uuid('host_organisation_id'),
    startsAt: ts('starts_at').notNull(),
    endsAt: ts('ends_at').notNull(),
    /** IANA zone the event is organised in. */
    timezone: text('timezone').notNull(),
    venueName: text('venue_name'),
    venueAddress: text('venue_address'),
    venueCity: text('venue_city'),
    venueMapUrl: text('venue_map_url'),
    countryCode: text('country_code').references(() => countries.code),
    onlinePlatform: text('online_platform'),
    /** Encrypted join link (encrypt()/decrypt() in common/crypto.ts). Never logged or sent in .ics. */
    onlineUrlEnc: text('online_url_enc'),
    registrationMode: text('registration_mode').notNull().default('internal'),
    externalUrl: text('external_url'),
    /** Null = unlimited. */
    capacity: integer('capacity'),
    waitlistEnabled: boolean('waitlist_enabled').notNull().default(true),
    registrationDeadline: ts('registration_deadline'),
    /** Seats held (registered + attended). */
    registeredCount: integer('registered_count').notNull().default(0),
    waitlistCount: integer('waitlist_count').notNull().default(0),
    agenda: jsonb('agenda').$type<EventAgendaRow[]>().notNull().default([]),
    coverFileId: uuid('cover_file_id').references(() => files.id, { onDelete: 'set null' }),
    featured: boolean('featured').notNull().default(false),
    featuredAt: ts('featured_at'),
    submittedAt: ts('submitted_at'),
    submitNote: text('submit_note'),
    reviewedAt: ts('reviewed_at'),
    reviewedBy: uuid('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
    /** Reviewer note (changes requested / rejected) or unpublish reason. */
    reviewNote: text('review_note'),
    /** First time the event went live. Host cannot change after this. */
    publishedAt: ts('published_at'),
    cancelledAt: ts('cancelled_at'),
    cancelReason: text('cancel_reason'),
    cancelledBy: uuid('cancelled_by').references(() => users.id, { onDelete: 'set null' }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('events_status_starts_idx').on(t.status, t.startsAt),
    index('events_status_ends_idx').on(t.status, t.endsAt),
    index('events_chapter_idx').on(t.hostChapterId, t.startsAt),
    index('events_host_member_idx').on(t.hostMemberId),
    index('events_country_idx').on(t.countryCode, t.startsAt),
    index('events_category_idx').on(t.categoryId),
    index('events_created_by_idx').on(t.createdBy),
    index('events_queue_idx').on(t.submittedAt).where(sql`${t.status} = 'pending_review'`),
    check('events_format_ck', sql`${t.format} in ('online','in_person','hybrid')`),
    check(
      'events_status_ck',
      sql`${t.status} in ('draft','pending_review','changes_requested','published','rejected','unpublished','archived')`,
    ),
    check('events_host_type_ck', sql`${t.hostType} in ('member','chapter','organisation')`),
    check(
      'events_host_ck',
      sql`(${t.hostType} = 'member' and ${t.hostMemberId} is not null and ${t.hostChapterId} is null and ${t.hostOrganisationId} is null)
        or (${t.hostType} = 'chapter' and ${t.hostChapterId} is not null and ${t.hostMemberId} is null and ${t.hostOrganisationId} is null)
        or (${t.hostType} = 'organisation' and ${t.hostOrganisationId} is not null and ${t.hostMemberId} is null and ${t.hostChapterId} is null)`,
    ),
    check('events_time_ck', sql`${t.endsAt} > ${t.startsAt}`),
    check('events_deadline_ck', sql`${t.registrationDeadline} is null or ${t.registrationDeadline} <= ${t.startsAt}`),
    check('events_reg_mode_ck', sql`${t.registrationMode} in ('internal','external')`),
    check('events_capacity_ck', sql`${t.capacity} is null or ${t.capacity} >= 1`),
    check('events_external_ck', sql`${t.registrationMode} = 'internal' or (${t.capacity} is null and ${t.externalUrl} is not null)`),
    check('events_counts_ck', sql`${t.registeredCount} >= 0 and ${t.waitlistCount} >= 0`),
  ],
);

/** Speakers in display order. A linked member supplies name/avatar on read. */
export const eventSpeakers = pgTable(
  'event_speakers',
  {
    id: id(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    name: text('name').notNull(),
    title: text('title'),
    organisation: text('organisation'),
    memberId: uuid('member_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('event_speakers_event_idx').on(t.eventId, t.position), index('event_speakers_member_idx').on(t.memberId)],
);

/**
 * One row per member and event (re-registering after cancelling updates the row).
 * position: waitlist sequence, assigned max(position)+1 for the event (under the event row lock)
 * whenever the row enters the waitlist, and never renumbered; the displayed place is the rank among
 * currently waitlisted rows. Promotion takes the lowest position.
 */
export const eventRegistrations = pgTable(
  'event_registrations',
  {
    id: id(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: text('status').notNull(),
    position: integer('position'),
    registeredAt: ts('registered_at').notNull().defaultNow(),
    promotedAt: ts('promoted_at'),
    cancelledAt: ts('cancelled_at'),
    attendedAt: ts('attended_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('event_registrations_uq').on(t.eventId, t.userId),
    uniqueIndex('event_registrations_position_uq').on(t.eventId, t.position).where(sql`${t.position} is not null`),
    index('event_registrations_event_status_idx').on(t.eventId, t.status, t.position),
    index('event_registrations_user_idx').on(t.userId, t.status),
    check('event_registrations_status_ck', sql`${t.status} in ('registered','waitlisted','cancelled','attended')`),
    check('event_registrations_waitlist_ck', sql`${t.status} <> 'waitlisted' or ${t.position} is not null`),
  ],
);

/** Makes reminders idempotent: insert … on conflict do nothing before sending. */
export const eventRemindersSent = pgTable(
  'event_reminders_sent',
  {
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Minutes before start (EVENT_REMINDER_OFFSETS: 1440, 60). */
    offsetMinutes: integer('offset_minutes').notNull(),
    sentAt: ts('sent_at').notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.eventId, t.userId, t.offsetMinutes] }),
    check('event_reminders_offset_ck', sql`${t.offsetMinutes} in (1440, 60)`),
  ],
);

/* ======================= Learning (spec 4.10, migration 0004) ======================= */

/** Reference topics; the sync maps Charter Center topic names onto these (creating unknown ones). */
export const courseTopics = taxonomy('course_topics');

/**
 * Synced copy of a Charter Center course. Content columns are overwritten by every sync; local
 * curation (hidden, featured) and link-check columns are never touched by the sync.
 * Members see a course when hidden = false and removed_at is null.
 */
export const courses = pgTable(
  'courses',
  {
    id: id(),
    externalId: text('external_id').notNull().unique(),
    /** From the source; on a clash with another course the mapper appends "-2", "-3" … */
    slug: text('slug').notNull().unique(),
    title: text('title').notNull(),
    provider: text('provider').notNull(),
    description: text('description').notNull().default(''),
    level: text('level').notNull().default('beginner'),
    durationMinutes: integer('duration_minutes'),
    lessons: integer('lessons'),
    /** BCP-47 tag. */
    language: text('language').notNull().default('en'),
    free: boolean('free').notNull().default(true),
    eligibility: text('eligibility'),
    accessConditions: text('access_conditions'),
    outcomes: text('outcomes').array().notNull().default(sql`'{}'::text[]`),
    /** Exact Charter Center course page ("Start learning"). */
    startUrl: text('start_url').notNull(),
    thumbnailUrl: text('thumbnail_url'),
    sourceUpdatedAt: ts('source_updated_at'),
    syncedAt: ts('synced_at').notNull().defaultNow(),
    /** Missing from the source (or archived there) since this time. */
    removedAt: ts('removed_at'),
    hidden: boolean('hidden').notNull().default(false),
    featured: boolean('featured').notNull().default(false),
    featuredAt: ts('featured_at'),
    linkStatus: text('link_status').notNull().default('unknown'),
    linkHttpStatus: integer('link_http_status'),
    linkCheckedAt: ts('link_checked_at'),
    /** Consecutive failed checks; broken at LEARNING_LINK_FAILURES_TO_BREAK. */
    linkFailures: integer('link_failures').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('courses_visible_idx').on(t.featured, t.sourceUpdatedAt).where(sql`${t.hidden} = false and ${t.removedAt} is null`),
    index('courses_language_idx').on(t.language),
    index('courses_level_idx').on(t.level),
    index('courses_link_idx').on(t.linkStatus),
    check('courses_level_ck', sql`${t.level} in ('beginner','intermediate','advanced')`),
    check('courses_link_status_ck', sql`${t.linkStatus} in ('ok','broken','unknown')`),
  ],
);

export const courseTopicLinks = pgTable(
  'course_topic_links',
  {
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    topicId: uuid('topic_id')
      .notNull()
      .references(() => courseTopics.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.courseId, t.topicId] }), index('course_topic_links_topic_idx').on(t.topicId)],
);

/** Curated sequences from Charter Center. */
export const learningPaths = pgTable(
  'learning_paths',
  {
    id: id(),
    externalId: text('external_id').notNull().unique(),
    slug: text('slug').notNull().unique(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    level: text('level'),
    sourceUrl: text('source_url'),
    /** Source order for the hub. */
    position: integer('position').notNull().default(0),
    sourceUpdatedAt: ts('source_updated_at'),
    syncedAt: ts('synced_at').notNull().defaultNow(),
    removedAt: ts('removed_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [check('learning_paths_level_ck', sql`${t.level} is null or ${t.level} in ('beginner','intermediate','advanced')`)],
);

export const learningPathCourses = pgTable(
  'learning_path_courses',
  {
    pathId: uuid('path_id')
      .notNull()
      .references(() => learningPaths.id, { onDelete: 'cascade' }),
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.pathId, t.courseId] }), index('learning_path_courses_order_idx').on(t.pathId, t.position), index('learning_path_courses_course_idx').on(t.courseId)],
);

/**
 * Catalogue syncs and link checks. At most one running row per kind (partial unique index): a
 * second start gets a unique violation → CONFLICT. A run still "running" after an hour is stale and
 * may be marked failed by the next run before it starts.
 */
export const learningSyncRuns = pgTable(
  'learning_sync_runs',
  {
    id: id(),
    kind: text('kind').notNull().default('sync'),
    trigger: text('trigger').notNull(),
    triggeredBy: uuid('triggered_by').references(() => users.id, { onDelete: 'set null' }),
    status: text('status').notNull().default('running'),
    startedAt: ts('started_at').notNull().defaultNow(),
    finishedAt: ts('finished_at'),
    createdCount: integer('created_count').notNull().default(0),
    updatedCount: integer('updated_count').notNull().default(0),
    removedCount: integer('removed_count').notNull().default(0),
    checkedCount: integer('checked_count').notNull().default(0),
    brokenCount: integer('broken_count').notNull().default(0),
    error: text('error'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('learning_sync_runs_started_idx').on(t.startedAt),
    uniqueIndex('learning_sync_runs_running_uq').on(t.kind).where(sql`${t.status} = 'running'`),
    check('learning_sync_runs_kind_ck', sql`${t.kind} in ('sync','link_check')`),
    check('learning_sync_runs_trigger_ck', sql`${t.trigger} in ('schedule','admin')`),
    check('learning_sync_runs_status_ck', sql`${t.status} in ('running','succeeded','failed')`),
  ],
);

/**
 * Members an admin unlocked Learning for, whatever the e-learning access rules say
 * (Settings → E-learning access). Deleting the row puts them back under the rules.
 */
export const learningAccessOverrides = pgTable('learning_access_overrides', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  note: text('note'),
  grantedBy: uuid('granted_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
});

/* ======================= Ambassador programme ======================= */

/**
 * People being considered for, or onboarded as, a country chapter's Ambassador. Created by
 * ambassador managers (admin console) from applications, nominations and outreach. One row per
 * email: someone who reapplies is moved back into the pipeline rather than duplicated.
 */
export const ambassadorLeads = pgTable(
  'ambassador_leads',
  {
    id: id(),
    fullName: text('full_name').notNull(),
    email: text('email').notNull(),
    phone: text('phone'),
    countryCode: text('country_code')
      .notNull()
      .references(() => countries.code),
    city: text('city'),
    organisation: text('organisation'),
    jobTitle: text('job_title'),
    linkedinUrl: text('linkedin_url'),
    source: text('source').notNull().default('outreach'),
    referredBy: text('referred_by'),
    hoursPerWeek: integer('hours_per_week'),
    motivation: text('motivation'),
    notes: text('notes'),
    stage: text('stage').notNull().default('new'),
    stageChangedAt: ts('stage_changed_at').notNull().defaultNow(),
    /** Rubric lines (LeadScores); score_total is their sum, null when nothing is scored. */
    scores: jsonb('scores').$type<Record<string, number | null>>().notNull().default({}),
    scoreTotal: integer('score_total'),
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
    /** The member account with this email, linked automatically when it exists. */
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    onboardingStartedAt: ts('onboarding_started_at'),
    invitedAt: ts('invited_at'),
    certifiedAt: ts('certified_at'),
    founding: boolean('founding').notNull().default(false),
    /** Signed in the member app (POST /ambassadors/me/agreement): typed name and the text version. */
    agreementSignedAt: ts('agreement_signed_at'),
    agreementSignedName: text('agreement_signed_name'),
    agreementVersion: text('agreement_version'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('ambassador_leads_email_uq').on(sql`lower(${t.email})`),
    index('ambassador_leads_stage_idx').on(t.stage, t.stageChangedAt),
    index('ambassador_leads_country_idx').on(t.countryCode),
    index('ambassador_leads_owner_idx').on(t.ownerId),
    index('ambassador_leads_user_idx').on(t.userId),
    check(
      'ambassador_leads_stage_ck',
      sql`${t.stage} in ('new','screening','review','interview','references','decision','onboarding','ambassador','alumni','talent_pool','declined','withdrawn')`,
    ),
    check('ambassador_leads_source_ck', sql`${t.source} in ('application','nomination','referral','outreach','event','other')`),
  ],
);

/** Timeline of a lead: notes, stage moves, scoring, onboarding ticks, emails, certification. */
export const ambassadorLeadActivities = pgTable(
  'ambassador_lead_activities',
  {
    id: id(),
    leadId: uuid('lead_id')
      .notNull()
      .references(() => ambassadorLeads.id, { onDelete: 'cascade' }),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    kind: text('kind').notNull(),
    body: text('body').notNull(),
    data: jsonb('data'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('ambassador_lead_activities_lead_idx').on(t.leadId, t.createdAt),
    check(
      'ambassador_lead_activities_kind_ck',
      sql`${t.kind} in ('created','updated','stage','note','scores','onboarding','training','invite','certified','term_ended','applied')`,
    ),
  ],
);

/** Onboarding checklist, one row per step once onboarding starts. */
export const ambassadorOnboardingSteps = pgTable(
  'ambassador_onboarding_steps',
  {
    leadId: uuid('lead_id')
      .notNull()
      .references(() => ambassadorLeads.id, { onDelete: 'cascade' }),
    step: text('step').notNull(),
    status: text('status').notNull().default('pending'),
    note: text('note'),
    completedAt: ts('completed_at'),
    completedBy: uuid('completed_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.leadId, t.step] }),
    check('ambassador_onboarding_steps_step_ck', sql`${t.step} in ('agreement','account','profile','training','orientation','first_event')`),
    check('ambassador_onboarding_steps_status_ck', sql`${t.status} in ('pending','done','waived')`),
  ],
);

/**
 * Required training courses marked complete for a lead. Charter Center does not report
 * completions, so a manager ticks each course once the lead shows their certificate.
 */
export const ambassadorTrainingProgress = pgTable(
  'ambassador_training_progress',
  {
    leadId: uuid('lead_id')
      .notNull()
      .references(() => ambassadorLeads.id, { onDelete: 'cascade' }),
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    completedAt: ts('completed_at').notNull().defaultNow(),
    markedBy: uuid('marked_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.leadId, t.courseId] })],
);


/* ----------------------------- Stories and highlights ----------------------------- */

/** A photo or short video shown in the feed strip for 24 hours (then archived, or kept by a highlight). */
export const stories = pgTable(
  'stories',
  {
    id: id(),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    fileId: uuid('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'cascade' }),
    caption: text('caption'),
    expiresAt: ts('expires_at').notNull(),
    moderationState: text('moderation_state').notNull().default('visible'),
    viewCount: integer('view_count').notNull().default(0),
    deletedAt: ts('deleted_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('stories_author_idx').on(t.authorId, t.createdAt),
    index('stories_expires_idx').on(t.expiresAt),
    check('stories_mod_ck', sql`${t.moderationState} in ('visible','hidden','removed')`),
  ],
);

export const storyViews = pgTable(
  'story_views',
  {
    storyId: uuid('story_id')
      .notNull()
      .references(() => stories.id, { onDelete: 'cascade' }),
    viewerId: uuid('viewer_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    viewedAt: ts('viewed_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.storyId, t.viewerId] }), index('story_views_viewer_idx').on(t.viewerId)],
);

/** Named collections of stories on a member's profile. */
export const storyHighlights = pgTable(
  'story_highlights',
  {
    id: id(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    position: integer('position').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('story_highlights_owner_idx').on(t.ownerId, t.position)],
);

export const storyHighlightItems = pgTable(
  'story_highlight_items',
  {
    highlightId: uuid('highlight_id')
      .notNull()
      .references(() => storyHighlights.id, { onDelete: 'cascade' }),
    storyId: uuid('story_id')
      .notNull()
      .references(() => stories.id, { onDelete: 'cascade' }),
    position: integer('position').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.highlightId, t.storyId] }), index('story_highlight_items_story_idx').on(t.storyId)],
);

/* ============================ Chapter pages ============================ */

/** Posts pinned to the top of a chapter page (at most CHAPTER_PIN_LIMIT per chapter). */
export const chapterPins = pgTable(
  'chapter_pins',
  {
    chapterId: uuid('chapter_id')
      .notNull()
      .references(() => chapters.id, { onDelete: 'cascade' }),
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    pinnedBy: uuid('pinned_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.chapterId, t.postId] }), index('chapter_pins_post_idx').on(t.postId)],
);

/* ============================ Opportunities ============================ */

/** A job, fellowship, grant or other opening posted by a verified member. Live on creation. */
export const opportunities = pgTable(
  'opportunities',
  {
    id: id(),
    slug: text('slug').notNull().unique(),
    posterId: uuid('poster_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    title: text('title').notNull(),
    organisation: text('organisation').notNull(),
    summary: text('summary').notNull(),
    description: text('description').notNull(),
    remoteMode: text('remote_mode').notNull(),
    countryCode: text('country_code').references(() => countries.code),
    city: text('city'),
    sectorId: uuid('sector_id').references(() => sectors.id, { onDelete: 'set null' }),
    /** Last day to apply, YYYY-MM-DD. */
    deadline: text('deadline'),
    compensation: text('compensation'),
    moreInfoUrl: text('more_info_url'),
    status: text('status').notNull().default('open'),
    moderationState: text('moderation_state').notNull().default('visible'),
    applicationCount: integer('application_count').notNull().default(0),
    closedAt: ts('closed_at'),
    deletedAt: ts('deleted_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('opportunities_poster_idx').on(t.posterId, t.createdAt),
    index('opportunities_list_idx').on(t.status, t.createdAt),
    index('opportunities_deadline_idx').on(t.deadline),
    check(
      'opportunities_type_ck',
      sql`${t.type} in ('employment','internship','fellowship','scholarship','grant','training','mentorship','volunteering','competition','call_for_proposals')`,
    ),
    check('opportunities_remote_ck', sql`${t.remoteMode} in ('remote','in_person','hybrid')`),
    check('opportunities_status_ck', sql`${t.status} in ('open','closed')`),
    check('opportunities_mod_ck', sql`${t.moderationState} in ('visible','hidden','removed')`),
  ],
);

/** A member's application: their profile plus a note. One per member per listing. */
export const opportunityApplications = pgTable(
  'opportunity_applications',
  {
    id: id(),
    opportunityId: uuid('opportunity_id')
      .notNull()
      .references(() => opportunities.id, { onDelete: 'cascade' }),
    applicantId: uuid('applicant_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    note: text('note').notNull(),
    status: text('status').notNull().default('submitted'),
    decidedAt: ts('decided_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('opportunity_applications_uq').on(t.opportunityId, t.applicantId),
    index('opportunity_applications_applicant_idx').on(t.applicantId, t.createdAt),
    check('opportunity_applications_status_ck', sql`${t.status} in ('submitted','shortlisted','accepted','declined','withdrawn')`),
  ],
);

/* ======================= Profile badges and featured members ======================= */

/** Admin-defined profile badges (Top Voice, Founding Member, Partner ...). */
export const badges = pgTable(
  'badges',
  {
    id: id(),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    /** primary | accent | warning | info | success */
    tone: text('tone').notNull().default('primary'),
    /** An icon name from @chartermission/ui. */
    icon: text('icon').notNull().default('verified'),
    /** active | disabled. Disabled badges are hidden on profiles and can't be awarded. */
    status: text('status').notNull().default('active'),
    position: integer('position').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('badges_status_ck', sql`${t.status} in ('active','disabled')`),
    check('badges_tone_ck', sql`${t.tone} in ('primary','accent','warning','info','success')`),
  ],
);

export const memberBadges = pgTable(
  'member_badges',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    badgeId: uuid('badge_id')
      .notNull()
      .references(() => badges.id, { onDelete: 'cascade' }),
    awardedBy: uuid('awarded_by').references(() => users.id, { onDelete: 'set null' }),
    note: text('note'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('member_badges_user_badge_uq').on(t.userId, t.badgeId), index('member_badges_user_idx').on(t.userId)],
);

/** Members an admin picks to be suggested first to people signing up (onboarding "People to follow"). */
export const featuredMembers = pgTable('featured_members', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  addedBy: uuid('added_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
