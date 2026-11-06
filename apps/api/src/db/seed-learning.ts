import type { Db } from './client.js';
import type { SeedContext } from './seed-data.js';

/**
 * Demo learning catalogue (called from seed.ts after members and chapters; course topics are
 * reference data seeded by seedReference). Must be idempotent.
 *
 * TODO(learning API agent): run the sync once with the FixtureCharterCenterClient (the JSON
 * fixture shipped in the repo) so courses and paths exist, record it as a learning_sync_runs row
 * (trigger "admin"), feature a few courses, mark one link broken for the admin view, and save a
 * course or two for amara (bookmarks targetType "course").
 */
export async function seedLearning(_db: Db, _ctx: SeedContext): Promise<void> {}
