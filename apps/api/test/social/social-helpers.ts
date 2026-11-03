import { eq } from 'drizzle-orm';
import type { TestApp } from '../helpers.js';
import { s } from '../helpers.js';
import { attachHashtags } from '../../src/posts/hashtags.js';
import { parseHashtags } from '../../src/posts/text-parse.js';

type Member = {
  id: string;
  post: (url: string, body?: object) => any;
  put: (url: string, body?: object) => any;
};

/** POST /posts and return the body (asserts 201). */
export async function createPost(m: Member, body: string, extra: Record<string, unknown> = {}) {
  const res = await m.post('/posts', { body, ...extra });
  if (res.status !== 201) throw new Error(`createPost failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as { id: string; [k: string]: any };
}

/** POST /uploads, then PUT the bytes to the signed local URL. Does not call /complete. */
export async function uploadBytes(
  t: TestApp,
  m: Member,
  opts: { purpose: 'post_image' | 'post_document' | 'avatar'; fileName: string; mime: string; data: Buffer },
) {
  const res = await m.post('/uploads', { purpose: opts.purpose, fileName: opts.fileName, mime: opts.mime, sizeBytes: opts.data.length });
  if (res.status !== 201) throw new Error(`upload failed: ${res.status} ${JSON.stringify(res.body)}`);
  const url = new URL(res.body.uploadUrl as string);
  const put = await t
    .http()
    .put(`${url.pathname}${url.search}`)
    .set('Content-Type', opts.mime)
    .send(opts.data);
  if (put.status !== 200) throw new Error(`blob PUT failed: ${put.status} ${JSON.stringify(put.body)}`);
  return res.body.fileId as string;
}

/** Insert a post straight into the database (for trending and pagination fixtures). */
export async function insertPost(
  t: TestApp,
  authorId: string,
  body: string,
  opts: { createdAt?: Date; countryCode?: string | null; chapterId?: string | null } = {},
) {
  const [p] = await t.db
    .insert(s.posts)
    .values({
      authorId,
      body,
      countryCode: opts.countryCode ?? null,
      chapterId: opts.chapterId ?? null,
      createdAt: opts.createdAt ?? new Date(),
    })
    .returning();
  await attachHashtags(t.db, p!.id, parseHashtags(body));
  return p!;
}

export async function block(t: TestApp, blockerId: string, blockedId: string) {
  await t.db.insert(s.blocks).values({ blockerId, blockedId });
}

export async function follow(t: TestApp, followerId: string, targetType: 'member' | 'hashtag' | 'chapter', targetId: string) {
  await t.db.insert(s.follows).values({ followerId, targetType, targetId });
}

export async function setTrendingRules(t: TestApp, value: Record<string, number>) {
  await t.db
    .insert(s.platformSettings)
    .values({ key: 'trending_rules', value })
    .onConflictDoUpdate({ target: s.platformSettings.key, set: { value } });
}

export async function postRow(t: TestApp, id: string) {
  const [row] = await t.db.select().from(s.posts).where(eq(s.posts.id, id));
  return row!;
}
