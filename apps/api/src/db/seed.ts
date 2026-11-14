import { hash } from '@node-rs/argon2';
import { eq, inArray, sql } from 'drizzle-orm';
import { createDb, createPool, type Db } from './client.js';
import * as s from './schema.js';
import {
  BADGES,
  CHAPTERS,
  CHAPTERS_PHOTO_VERSION,
  CHAPTERS_PROFILE_VERSION,
  chapterSets,
  COUNTRIES,
  FEATURED_HASHTAG_SETS,
  REFERENCE_SEED_VERSIONS,
  COURSE_TOPICS,
  DEMO_PASSWORD,
  EVENT_CATEGORIES,
  INTERESTS,
  LANGUAGES,
  MEMBERS,
  SECTORS,
  SKILLS,
  type SeedContext,
} from './seed-data.js';
import { seedEvents } from './seed-events.js';
import { seedLearning } from './seed-learning.js';
import { seedDemoExams, seedExams } from './seed-exams.js';
import { seedAmbassadors } from './seed-ambassadors.js';
import { seedStories } from './seed-stories.js';
import { seedModeration } from './seed-moderation.js';
import { seedChaptersAndOpportunities } from './seed-opportunities.js';
import { seedPages } from './seed-pages.js';
import { seedInitiatives } from './seed-initiatives.js';
import { CHAPTER_PHOTOS } from './chapter-photos.js';
import { seedDemoMfa } from './seed-accounts.js';
import { PERMISSIONS, ROLES } from '../core/permissions.js';
import { SETTING_DEFAULTS } from '../infra/settings.service.js';
import { DEFAULT_FIELD_VISIBILITY } from '@chartermission/contracts';
import { isMain } from './is-main.js';
import { chapterDefaults } from '../chapters/chapter-defaults.js';

const slug = (v: string) => v.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export async function seedReference(db: Db) {
  await db.insert(s.countries).values(COUNTRIES.map(([code, name, region]) => ({ code, name, region }))).onConflictDoNothing();
  for (const [table, items] of [
    [s.sectors, SECTORS],
    [s.skills, SKILLS],
    [s.interests, INTERESTS],
    [s.languages, LANGUAGES],
    [s.eventCategories, EVENT_CATEGORIES],
  ] as const) {
    await db
      .insert(table)
      .values(items.map((name, i) => ({ slug: slug(name), name, position: i })))
      .onConflictDoNothing();
  }
  await db
    .insert(s.courseTopics)
    .values(COURSE_TOPICS.map(([sl, name], i) => ({ slug: sl, name, position: i })))
    .onConflictDoNothing();
  await seedCatalogues(db);
  await db
    .insert(s.permissions)
    .values(Object.entries(PERMISSIONS).map(([key, description]) => ({ key, description })))
    .onConflictDoNothing();
  for (const [key, role] of Object.entries(ROLES)) {
    const [row] = await db
      .insert(s.roles)
      .values({ key, name: role.name, requiresMfa: role.requiresMfa })
      .onConflictDoUpdate({ target: s.roles.key, set: { name: role.name, requiresMfa: role.requiresMfa } })
      .returning({ id: s.roles.id });
    if (!role.permissions.length) continue;
    await db
      .insert(s.rolePermissions)
      .values(role.permissions.map((permissionKey) => ({ roleId: row!.id, permissionKey })))
      .onConflictDoNothing();
  }
  for (const [key, value] of Object.entries(SETTING_DEFAULTS)) {
    await db.insert(s.platformSettings).values({ key, value }).onConflictDoNothing();
  }
}

const SEEDS_KEY = 'reference_seeds';

/**
 * Chapters, featured hashtags, badges and exams: admins add, remove and edit these, so each catalogue is
 * seeded only when its REFERENCE_SEED_VERSIONS entry is newer than the version recorded in
 * platform_settings. Inserts never overwrite existing rows.
 */
async function seedCatalogues(db: Db) {
  const [row] = await db.select({ value: s.platformSettings.value }).from(s.platformSettings).where(eq(s.platformSettings.key, SEEDS_KEY));
  const done = { ...((row?.value as Record<string, number> | undefined) ?? {}) };
  const due = (k: keyof typeof REFERENCE_SEED_VERSIONS) => (done[k] ?? 0) < REFERENCE_SEED_VERSIONS[k];

  if (due('chapters')) {
    // Each step runs once: a later version never re-creates a chapter an admin removed.
    const had = done.chapters ?? 0;
    const added: string[] = [];
    for (const set of chapterSets()) {
      if (had >= set.version) continue;
      const rows = await db
        .insert(s.chapters)
        .values(set.chapters.map(([sl, name, countryCode]) => ({ slug: sl, name, countryCode })))
        .onConflictDoNothing()
        .returning({ id: s.chapters.id });
      added.push(...rows.map((r) => r.id));
    }
    // Hashtag and About text: every chapter the first time, afterwards only the chapters just added
    // (an About an admin has since cleared on purpose stays empty).
    if (had < CHAPTERS_PROFILE_VERSION) await seedChapterProfiles(db);
    else if (added.length) await seedChapterProfiles(db, added);
    if (had < CHAPTERS_PHOTO_VERSION) await seedChapterPhotos(db);
    done.chapters = REFERENCE_SEED_VERSIONS.chapters;
  }
  if (due('hashtags')) {
    // Only the sets newer than what this database has: topics an admin un-featured stay that way.
    for (const set of FEATURED_HASHTAG_SETS) {
      if ((done.hashtags ?? 0) >= set.version) continue;
      for (const [display, description] of set.tags) {
        await db
          .insert(s.hashtags)
          .values({ tag: display.toLowerCase(), display, description, featured: true })
          .onConflictDoUpdate({
            target: s.hashtags.tag,
            set: { featured: true, description: sql`coalesce(${s.hashtags.description}, excluded.description)` },
          });
      }
    }
    done.hashtags = REFERENCE_SEED_VERSIONS.hashtags;
  }
  if (due('badges')) {
    await db
      .insert(s.badges)
      .values(BADGES.map((b, i) => ({ ...b, position: i })))
      .onConflictDoNothing();
    done.badges = REFERENCE_SEED_VERSIONS.badges;
  }
  if (due('exams')) {
    // 1 = the Charter Center CAPM practice exam, as a draft for an admin to review and publish.
    await seedExams(db);
    done.exams = REFERENCE_SEED_VERSIONS.exams;
  }
  await db
    .insert(s.platformSettings)
    .values({ key: SEEDS_KEY, value: done })
    .onConflictDoUpdate({ target: s.platformSettings.key, set: { value: done } });
}

/**
 * Gives every chapter that exists its own hashtag and an About text written for its country
 * (chapters/chapter-defaults.ts). Only empty fields are filled: text an Ambassador or admin wrote,
 * and a hashtag an admin chose, are kept. Chapters added from the admin console are included.
 * The chapter's logo and cover need no seeding: they are drawn for each chapter from its name
 * and its country's flag colours until an admin uploads a picture.
 */
export async function seedChapterProfiles(db: Db, only?: string[]) {
  const rows = await db
    .select({
      id: s.chapters.id,
      name: s.chapters.name,
      countryCode: s.chapters.countryCode,
      about: s.chapters.about,
      hashtag: s.chapters.hashtag,
      countryName: s.countries.name,
      region: s.countries.region,
    })
    .from(s.chapters)
    .innerJoin(s.countries, eq(s.countries.code, s.chapters.countryCode))
    .where(only ? inArray(s.chapters.id, only) : undefined);
  for (const row of rows) {
    const defaults = chapterDefaults(row);
    const hashtag = defaults.hashtag;
    if (!row.about?.trim() || !row.hashtag) {
      await db
        .update(s.chapters)
        .set({ about: row.about?.trim() ? row.about : defaults.about, hashtag })
        .where(eq(s.chapters.id, row.id));
    }
    // The topic itself, so it can be followed and searched before anyone has used it. Not featured:
    // onboarding suggests the member's own chapter instead of listing every country.
    await db
      .insert(s.hashtags)
      .values({ tag: hashtag.toLowerCase(), display: hashtag, description: defaults.hashtagDescription })
      .onConflictDoUpdate({ target: s.hashtags.tag, set: { description: sql`coalesce(${s.hashtags.description}, excluded.description)` } });
  }
}

/**
 * A landmark photograph for each chapter's cover (db/chapter-photos.ts), shown behind the title
 * until an admin uploads a cover of their own. Only chapters without a photo are touched, so a
 * photo an admin chose in the console is kept.
 */
export async function seedChapterPhotos(db: Db) {
  const rows = await db.select({ id: s.chapters.id, countryCode: s.chapters.countryCode, photoUrl: s.chapters.photoUrl }).from(s.chapters);
  for (const row of rows) {
    const photo = CHAPTER_PHOTOS[row.countryCode];
    if (!photo || row.photoUrl) continue;
    await db
      .update(s.chapters)
      .set({ photoUrl: photo.url, photoCredit: photo.credit, photoCreditUrl: photo.creditUrl })
      .where(eq(s.chapters.id, row.id));
  }
}

/** Demo members (verified emails, completed onboarding). Returns user ids keyed by SeedMember.key. */
export async function seedMembers(db: Db): Promise<Record<string, string>> {
  const passwordHash = await hash(DEMO_PASSWORD);
  const ids: Record<string, string> = {};
  const roleRows = await db.select().from(s.roles);
  const versions = SETTING_DEFAULTS.policy_versions;
  const sectorRows = await db.select({ id: s.sectors.id, name: s.sectors.name }).from(s.sectors);
  for (const m of MEMBERS) {
    const joinedAt = new Date(Date.now() - m.joinedDaysAgo * 86_400_000);
    const [u] = await db
      .insert(s.users)
      .values({
        email: m.email,
        passwordHash,
        status: 'active',
        emailVerifiedAt: joinedAt,
        isStaff: !!m.staff,
        isOfficial: !!m.staff || m.key === 'team',
        verifiedAt: m.verified || m.staff ? new Date() : null,
        createdAt: joinedAt,
      })
      .onConflictDoNothing()
      .returning({ id: s.users.id });
    const id =
      u?.id ?? (await db.select({ id: s.users.id }).from(s.users).where(sql`lower(email) = ${m.email}`))[0]!.id;
    ids[m.key] = id;
    await db
      .insert(s.memberProfiles)
      .values({
        userId: id,
        handle: m.handle,
        displayName: m.name,
        headline: m.headline,
        countryCode: m.country,
        city: m.city,
        bio: m.bio ?? null,
        organisation: m.organisation ?? null,
        avatarTone: m.tone,
        fieldVisibility: { ...DEFAULT_FIELD_VISIBILITY },
        onboardingStep: 4,
        onboardingCompletedAt: joinedAt,
        createdAt: joinedAt,
      })
      .onConflictDoNothing();
    const sectorIds = (m.sectors ?? []).map((name) => sectorRows.find((r) => r.name === name)?.id).filter((x): x is string => !!x);
    if (sectorIds.length) {
      await db
        .insert(s.profileSectors)
        .values(sectorIds.map((itemId) => ({ userId: id, itemId })))
        .onConflictDoNothing();
    }
    await db
      .insert(s.consentRecords)
      .values((['terms', 'privacy', 'guidelines'] as const).map((p) => ({ userId: id, policyType: p, policyVersion: versions[p] })))
      .onConflictDoNothing();
    for (const roleKey of m.roles ?? []) {
      const role = roleRows.find((r) => r.key === roleKey);
      if (role) await db.insert(s.userRoles).values({ userId: id, roleId: role.id }).onConflictDoNothing();
    }
  }
  return ids;
}

export async function resetDatabase(db: Db) {
  const rows = await db.execute<{ tablename: string }>(
    sql`select tablename from pg_tables where schemaname = 'public' and tablename <> '__drizzle_migrations'`,
  );
  const names = rows.rows.map((r) => `"${r.tablename}"`).join(', ');
  // audit_log blocks DELETE/UPDATE but TRUNCATE is allowed for dev resets only.
  if (names) await db.execute(sql.raw(`truncate ${names} restart identity cascade`));
}

/**
 * The demo seed is for empty development and staging databases. It creates staff accounts with a
 * published password, and --reset empties every table, so it must never meet real members.
 * This refuses to continue when the database holds accounts that are not demo accounts, unless the
 * command names that database: --confirm-database=<name>.
 */
export async function assertSafeToSeedDemo(db: Db, argv: string[] = process.argv) {
  const demoEmails = MEMBERS.map((m) => m.email.toLowerCase());
  const [info] = (
    await db.execute<{ name: string; real: number }>(
      // Demo accounts: the seeded staff accounts, and anything on the reserved example domains.
      sql`select current_database() as name, (select count(*)::int from ${s.users} u
            where lower(u.email) not in (${sql.join(demoEmails.map((e) => sql`${e}`), sql`, `)})
              and split_part(lower(u.email), '@', 2) not in ('example.com', 'example.org', 'example.net', 'example.test')) as real`,
    )
  ).rows;
  if (!info || info.real === 0) return;
  const confirmed = argv.find((a) => a.startsWith('--confirm-database='))?.split('=')[1];
  if (confirmed === info.name) return;
  const what = argv.includes('--reset') ? 'reset (this deletes every member, post and setting)' : 'add demo accounts and demo content to';
  throw new Error(
    `Refusing to ${what} the database "${info.name}": it has ${info.real} real account${info.real === 1 ? '' : 's'}.\n` +
      `Reference data (chapters, hashtags, badges, roles) is applied without demo data by: node dist/db/bootstrap.js (it runs on every API start).\n` +
      `If this really is a throwaway database, run the command again with --confirm-database=${info.name}`,
  );
}

async function main() {
  if (process.env.NODE_ENV === 'production' && !process.argv.includes('--force')) {
    throw new Error('Refusing to seed demo data in production (pass --force for staging).');
  }
  const pool = createPool();
  const db = createDb(pool);
  try {
    await assertSafeToSeedDemo(db);
    if (process.argv.includes('--reset')) await resetDatabase(db);
    await seedReference(db);
    const ids = await seedMembers(db);
    try {
      const content = (await import('./seed-content.js')) as { seedContent?: (db: Db, ids: Record<string, string>) => Promise<void> };
      await content.seedContent?.(db, ids);
    } catch (err) {
      if ((err as { code?: string }).code !== 'ERR_MODULE_NOT_FOUND') throw err;
    }
    const chapterRows = await db.select({ id: s.chapters.id, slug: s.chapters.slug }).from(s.chapters);
    const ctx: SeedContext = { ids, chapters: Object.fromEntries(chapterRows.map((c) => [c.slug, c.id])) };
    await seedEvents(db, ctx);
    await seedLearning(db, ctx);
    await seedDemoExams(db);
    await seedAmbassadors(db, ctx);
    await seedStories(db, ctx);
    await seedModeration(db, ctx);
    await seedChaptersAndOpportunities(db, ctx);
    await seedPages(db, ctx);
    await seedInitiatives(db, ctx);
    const mfa = await seedDemoMfa(db);
    console.log(`Seeded ${Object.keys(ids).length} demo members (password: ${DEMO_PASSWORD})`);
    if (mfa.length) console.log(`Two-step verification preset for ${mfa.length} staff accounts: ${mfa.join(', ')} (see the demo accounts PDF)`);
  } finally {
    await pool.end();
  }
}

if (isMain(import.meta.url)) {
  await main().catch((err: unknown) => {
    // A refusal is an answer, not a crash: say why and stop, without a stack trace.
    if (err instanceof Error && err.message.startsWith('Refusing')) {
      console.error(`\n${err.message}\n`);
      process.exit(1);
    }
    throw err;
  });
}
