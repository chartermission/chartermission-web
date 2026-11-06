import type { Db } from './client.js';
import type { SeedContext } from './seed-data.js';

/**
 * Demo events (called from seed.ts after members, chapters and feed content; event categories are
 * reference data seeded by seedReference). Must be idempotent: skip when demo events exist.
 *
 * TODO(events API agent): seed a realistic set matching apps/web/src/lib/mock/events.ts —
 * upcoming and past events across formats, member and chapter hosts, internal (with capacity,
 * some full with a waitlist) and external registration, speakers and agenda, a few drafts /
 * pending_review items for the admin queue, demo registrations (amara registered for two), and
 * the event_host / scoped chapter_lead role grants for the demo hosts. Encrypt online URLs with
 * encrypt() from ../common/crypto.js.
 */
export async function seedEvents(_db: Db, _ctx: SeedContext): Promise<void> {}
