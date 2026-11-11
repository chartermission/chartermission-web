import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import sharp from 'sharp';
import { parseVideoEmbed, type HighlightView, type StoryTray, type StoryView } from '@chartermission/contracts';
import { createMember, createTestApp, s, type TestApp } from '../helpers.js';
import { canRemux, ffmpegPaths, probeVideo, remuxVideo, transcodeVideo } from '../../src/media/video.js';
import { SettingsService } from '../../src/infra/settings.service.js';
import { StoriesService } from '../../src/stories/stories.service.js';
import { createPost, follow, uploadBytes } from './social-helpers.js';

type Member = Awaited<ReturnType<typeof createMember>>;

describe('Video links', () => {
  it('recognises supported platforms and builds privacy-friendly players', () => {
    expect(parseVideoEmbed('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m5s')).toMatchObject({
      provider: 'youtube',
      videoId: 'dQw4w9WgXcQ',
      embedUrl: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0&start=65',
      vertical: false,
    });
    expect(parseVideoEmbed('https://youtu.be/dQw4w9WgXcQ')?.videoId).toBe('dQw4w9WgXcQ');
    expect(parseVideoEmbed('https://youtube.com/shorts/dQw4w9WgXcQ')).toMatchObject({ provider: 'youtube', vertical: true });
    expect(parseVideoEmbed('https://vimeo.com/76979871')?.embedUrl).toBe('https://player.vimeo.com/video/76979871');
    expect(parseVideoEmbed('https://vimeo.com/76979871/abc123def')?.embedUrl).toBe('https://player.vimeo.com/video/76979871?h=abc123def');
    expect(parseVideoEmbed('https://www.loom.com/share/0123456789abcdef0123456789abcdef')?.provider).toBe('loom');
    expect(parseVideoEmbed('https://www.tiktok.com/@someone/video/7234567890123456789')).toMatchObject({ provider: 'tiktok', vertical: true });
    expect(parseVideoEmbed('https://dai.ly/x8abcde')?.provider).toBe('dailymotion');
    expect(parseVideoEmbed('https://www.youtube.com/watch?v=short')).toBeNull();
    expect(parseVideoEmbed('https://example.com/video/123')).toBeNull();
    expect(parseVideoEmbed('javascript:alert(1)')).toBeNull();
  });
});

describe('Video posts, media settings and stories', () => {
  let t: TestApp;
  let admin: Member;
  let dir: string;
  let ffmpeg: string | null = null;

  async function makeVideo(name: string, seconds: number): Promise<Buffer> {
    const out = path.join(dir, name);
    const res = spawnSync(
      ffmpeg!,
      [
        '-y', '-f', 'lavfi', '-i', `testsrc=duration=${seconds}:size=640x360:rate=25`,
        '-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`,
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', out,
      ],
      { stdio: 'ignore' },
    );
    if (res.status !== 0) throw new Error('ffmpeg could not make the test clip');
    return readFile(out);
  }

  async function png() {
    return sharp({ create: { width: 360, height: 640, channels: 3, background: { r: 20, g: 120, b: 80 } } })
      .png()
      .toBuffer();
  }

  async function storyFrom(m: Member, caption?: string): Promise<StoryView> {
    const fileId = await uploadBytes(t, m, { purpose: 'story_image', fileName: 'story.png', mime: 'image/png', data: await png() });
    expect((await m.post(`/uploads/${fileId}/complete`).expect(200)).body.status).toBe('clean');
    return (await m.post('/stories', { fileId, caption }).expect(201)).body as StoryView;
  }

  beforeAll(async () => {
    t = await createTestApp();
    admin = await createMember(t, { name: 'Ada Admin', roles: ['platform_admin'], admin: true });
    dir = await mkdtemp(path.join(os.tmpdir(), 'cm-video-test-'));
    const { ffmpeg: bin } = await ffmpegPaths();
    ffmpeg = spawnSync(bin, ['-version'], { stdio: 'ignore' }).status === 0 ? bin : null;
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
    await t.close();
  });
  afterEach(async () => {
    await t.app.get(SettingsService).set('media_limits', { postVideoMaxSeconds: 600, storyVideoMaxSeconds: 60, introVideoMaxSeconds: 300 }, null);
  });

  it('shows a player for video links', async () => {
    const m = await createMember(t);
    const post = await createPost(m, 'Our launch talk https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(post.linkPreview).toMatchObject({ embed: { provider: 'youtube', videoId: 'dQw4w9WgXcQ' } });
    const plain = await createPost(m, 'Read this https://example.com/article');
    expect(plain.linkPreview?.embed ?? null).toBeNull();
  });

  it('lets Platform Admins set the video length limits; members read them', async () => {
    const m = await createMember(t);
    expect((await m.get('/uploads/limits').expect(200)).body).toEqual({ postVideoMaxSeconds: 600, storyVideoMaxSeconds: 60, introVideoMaxSeconds: 300 });
    const mod = await createMember(t, { roles: ['moderator'], admin: true });
    await mod.put('/admin/settings/media', { postVideoMaxSeconds: 120, storyVideoMaxSeconds: 30, introVideoMaxSeconds: 300 }).expect(403);
    await admin.put('/admin/settings/media', { postVideoMaxSeconds: 4000, storyVideoMaxSeconds: 30, introVideoMaxSeconds: 300 }).expect(422);
    const saved = (await admin.put('/admin/settings/media', { postVideoMaxSeconds: 120, storyVideoMaxSeconds: 30, introVideoMaxSeconds: 300 }).expect(200)).body;
    expect(saved).toEqual({ postVideoMaxSeconds: 120, storyVideoMaxSeconds: 30, introVideoMaxSeconds: 300 });
    expect((await m.get('/uploads/limits').expect(200)).body.postVideoMaxSeconds).toBe(120);
    const audit = await t.db.select().from(s.auditLog).where(eq(s.auditLog.action, 'settings.media.updated'));
    expect(audit.length).toBeGreaterThan(0);
  });

  it('converts an uploaded video, serves it with a poster and byte ranges, and attaches it to a post', async (ctx) => {
    if (!ffmpeg) ctx.skip();
    const m = await createMember(t);
    await m.post('/uploads', { purpose: 'post_video', fileName: 'a.avi', mime: 'video/x-msvideo', sizeBytes: 10 }).expect(415);
    const data = await makeVideo('short.mp4', 3);
    const id = await uploadBytes(t, m, { purpose: 'post_video', fileName: 'clip.mp4', mime: 'video/mp4', data });
    const file = (await m.post(`/uploads/${id}/complete`).expect(200)).body;
    expect(file).toMatchObject({ status: 'clean', mime: 'video/mp4' });
    expect(file.durationSeconds).toBeGreaterThan(2.5);
    expect(file.durationSeconds).toBeLessThan(3.5);
    expect(file.posterUrl).toMatch(/\/media\/.+\/poster$/);

    const poster = await m.get(`/media/${id}/poster`).expect(200);
    expect(poster.headers['content-type']).toBe('image/jpeg');
    const part = await m.get(`/media/${id}`).set('Range', 'bytes=0-99').expect(206);
    expect(part.headers['content-range']).toMatch(/^bytes 0-99\//);

    const image = await uploadBytes(t, m, { purpose: 'post_image', fileName: 'a.png', mime: 'image/png', data: await png() });
    await m.post(`/uploads/${image}/complete`).expect(200);
    await m.post('/posts', { body: 'Both', attachmentIds: [id, image] }).expect(422);
    await m.post('/posts', { body: 'Poll too', attachmentIds: [id], poll: { question: 'Q?', options: ['a', 'b'] } }).expect(422);

    const post = await createPost(m, 'Watch this', { attachmentIds: [id] });
    expect(post.attachments).toEqual([expect.objectContaining({ id, kind: 'video', posterUrl: expect.stringContaining('/poster') })]);
    expect(post.status).toBe('published');
  });

  it('repackages web-ready videos without re-encoding and caps big ones at 720p / 30 fps', async (ctx) => {
    if (!ffmpeg) ctx.skip();
    // A small H.264/AAC clip is already web-ready: copied, not re-encoded.
    await makeVideo('ready.mp4', 2);
    const ready = await probeVideo(path.join(dir, 'ready.mp4'));
    expect(canRemux(ready, false)).toBe(true);
    expect(canRemux(ready, true)).toBe(false); // a trim needs a frame-accurate cut
    await remuxVideo(path.join(dir, 'ready.mp4'), path.join(dir, 'ready-out.mp4'));
    const copied = await probeVideo(path.join(dir, 'ready-out.mp4'));
    expect(copied).toMatchObject({ width: 640, height: 360, videoCodec: 'h264', audioCodec: 'aac' });

    // A 1080p 60 fps phone-style clip is re-encoded to 1280×720 at 30 fps.
    const big = path.join(dir, 'big.mp4');
    const made = spawnSync(
      ffmpeg!,
      ['-y', '-f', 'lavfi', '-i', 'testsrc=duration=2:size=1920x1080:rate=60', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', big],
      { stdio: 'ignore' },
    );
    expect(made.status).toBe(0);
    const source = await probeVideo(big);
    expect(canRemux(source, false)).toBe(false);
    await transcodeVideo(big, path.join(dir, 'big-out.mp4'), source.durationSeconds, undefined, source);
    const out = await probeVideo(path.join(dir, 'big-out.mp4'));
    expect(out).toMatchObject({ width: 1280, height: 720, videoCodec: 'h264' });
    expect(Math.round(out.fps)).toBe(30);
  });

  it('rejects videos longer than the admin limit', async (ctx) => {
    if (!ffmpeg) ctx.skip();
    await admin.put('/admin/settings/media', { postVideoMaxSeconds: 10, storyVideoMaxSeconds: 5, introVideoMaxSeconds: 300 }).expect(200);
    const m = await createMember(t);
    const data = await makeVideo('long.mp4', 12);
    const id = await uploadBytes(t, m, { purpose: 'post_video', fileName: 'long.mp4', mime: 'video/mp4', data });
    const file = (await m.post(`/uploads/${id}/complete`).expect(200)).body;
    expect(file.status).toBe('rejected');
    expect(file.rejectionReason).toMatch(/up to 0:10/);
  });

  it('shows stories to connections and followers for 24 hours, counts views, and keeps highlighted ones', async () => {
    const author = await createMember(t, { name: 'Amara Okafor' });
    const follower = await createMember(t, { name: 'Kofi Follower' });
    const connection = await createMember(t, { name: 'Lina Connection' });
    const stranger = await createMember(t, { name: 'Sam Stranger' });
    await follow(t, follower.id, 'member', author.id);
    await t.db.insert(s.connections).values({ requesterId: connection.id, addresseeId: author.id, status: 'accepted', respondedAt: new Date() });

    const story = await storyFrom(author, 'Day one in Kigali');
    expect(story).toMatchObject({ caption: 'Day one in Kigali', media: { kind: 'image' }, viewer: { own: true }, viewCount: 0, expired: false });
    // A file can only be used once.
    const reuse = await t.db.select({ fileId: s.stories.fileId }).from(s.stories).where(eq(s.stories.id, story.id));
    await author.post('/stories', { fileId: reuse[0]!.fileId }).expect(422);

    const mine = (await author.get('/stories/tray').expect(200)).body as StoryTray;
    expect(mine.mine?.stories.map((x) => x.id)).toEqual([story.id]);
    for (const who of [follower, connection]) {
      const tray = (await who.get('/stories/tray').expect(200)).body as StoryTray;
      expect(tray.items).toEqual([expect.objectContaining({ author: expect.objectContaining({ id: author.id }), hasUnseen: true })]);
    }
    expect(((await stranger.get('/stories/tray').expect(200)).body as StoryTray).items).toEqual([]);
    await stranger.get(`/stories/${story.id}`).expect(404);

    await follower.post(`/stories/${story.id}/view`).expect(204);
    await follower.post(`/stories/${story.id}/view`).expect(204);
    await author.post(`/stories/${story.id}/view`).expect(204);
    expect(((await follower.get('/stories/tray').expect(200)).body as StoryTray).items[0]!.hasUnseen).toBe(false);
    expect(((await author.get(`/stories/${story.id}`).expect(200)).body as StoryView).viewCount).toBe(1);
    const viewers = (await author.get(`/stories/${story.id}/viewers`).expect(200)).body;
    expect(viewers.map((v: { member: { id: string } }) => v.member.id)).toEqual([follower.id]);
    await follower.get(`/stories/${story.id}/viewers`).expect(403);

    // Highlights keep a story on the profile after it expires.
    const highlight = (await author.post('/highlights', { title: 'Kigali', storyIds: [story.id] }).expect(201)).body as HighlightView;
    expect(highlight.stories.map((x) => x.id)).toEqual([story.id]);
    await author.post('/highlights', { title: 'Theirs', storyIds: [(await storyFrom(follower)).id] }).expect(422);
    await t.db.update(s.stories).set({ expiresAt: new Date(Date.now() - 60_000) }).where(eq(s.stories.id, story.id));
    expect(((await follower.get('/stories/tray').expect(200)).body as StoryTray).items).toEqual([]);
    const onProfile = (await stranger.get(`/highlights?member=${author.handle}`).expect(200)).body as HighlightView[];
    expect(onProfile[0]!.stories[0]).toMatchObject({ id: story.id, expired: true });
    await stranger.get(`/stories/${story.id}`).expect(200);

    // Out of every highlight, an expired story is the author's alone (archive), then purged.
    await author.delete(`/highlights/${highlight.id}`).expect(204);
    await stranger.get(`/stories/${story.id}`).expect(404);
    expect(((await author.get('/stories/archive').expect(200)).body as StoryView[]).map((x) => x.id)).toContain(story.id);
    const old = new Date(Date.now() - 32 * 24 * 3600_000);
    await t.db.update(s.stories).set({ expiresAt: old, createdAt: old }).where(eq(s.stories.id, story.id));
    expect(await t.app.get(StoriesService).purge()).toBeGreaterThanOrEqual(1);
    expect(await t.db.select().from(s.stories).where(eq(s.stories.id, story.id))).toHaveLength(0);
  });

  it('lets members report stories and authors delete them (and their empty highlights)', async () => {
    const author = await createMember(t);
    const follower = await createMember(t);
    await follow(t, follower.id, 'member', author.id);
    const story = await storyFrom(author);
    await follower.post('/reports', { targetType: 'story', targetId: story.id, reason: 'spam' }).expect(201);
    const [report] = await t.db
      .select()
      .from(s.contentReports)
      .where(and(eq(s.contentReports.targetType, 'story'), eq(s.contentReports.targetId, story.id)));
    expect(report).toBeDefined();

    const highlight = (await author.post('/highlights', { title: 'Mine', storyIds: [story.id] }).expect(201)).body as HighlightView;
    await follower.delete(`/stories/${story.id}`).expect(403);
    await author.delete(`/stories/${story.id}`).expect(204);
    await follower.get(`/stories/${story.id}`).expect(404);
    expect(await t.db.select().from(s.storyHighlights).where(eq(s.storyHighlights.id, highlight.id))).toHaveLength(0);
  });
});
