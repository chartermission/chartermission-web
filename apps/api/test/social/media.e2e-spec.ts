import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { createMember, createTestApp, s, type TestApp } from '../helpers.js';
import { EICAR } from '../../src/media/scanner.js';
import { createPost, uploadBytes } from './social-helpers.js';

async function jpegWithExif(width: number, height: number) {
  return sharp({ create: { width, height, channels: 3, background: { r: 200, g: 120, b: 40 } } })
    .jpeg()
    .withExif({ IFD0: { Copyright: 'secret-gps-owner', Artist: 'Someone' } })
    .toBuffer();
}

async function png(width = 8, height = 8) {
  return sharp({ create: { width, height, channels: 3, background: { r: 0, g: 0, b: 255 } } })
    .png()
    .toBuffer();
}

/** A minimal Windows PE header: "MZ" … "PE\0\0" — what a renamed .exe looks like. */
function fakeExe(): Buffer {
  const b = Buffer.alloc(512);
  b.write('MZ', 0, 'latin1');
  b.writeUInt32LE(0x80, 0x3c);
  b.write('PE\0\0', 0x80, 'latin1');
  return b;
}

describe('Uploads and media', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });

  it('requires a verified member and validates purpose, MIME, extension and size', async () => {
    const unverified = await createMember(t, { verified: false });
    expect(
      (await unverified.post('/uploads', { purpose: 'post_image', fileName: 'a.png', mime: 'image/png', sizeBytes: 10 }).expect(403)).body
        .error.code,
    ).toBe('EMAIL_NOT_VERIFIED');
    const m = await createMember(t);
    await m.post('/uploads', { purpose: 'post_image', fileName: 'a.pdf', mime: 'application/pdf', sizeBytes: 10 }).expect(415);
    await m.post('/uploads', { purpose: 'post_image', fileName: 'a.gif', mime: 'image/png', sizeBytes: 10 }).expect(415);
    await m.post('/uploads', { purpose: 'post_document', fileName: 'a.exe', mime: 'application/pdf', sizeBytes: 10 }).expect(415);
    await m.post('/uploads', { purpose: 'post_image', fileName: 'a.png', mime: 'image/png', sizeBytes: 6 * 1024 * 1024 }).expect(413);
    await m.post('/uploads', { purpose: 'post_document', fileName: 'a.pdf', mime: 'application/pdf', sizeBytes: 11 * 1024 * 1024 }).expect(413);
  });

  it('rejects a bad signature on the upload URL and bodies larger than declared', async () => {
    const m = await createMember(t);
    const res = await m.post('/uploads', { purpose: 'post_image', fileName: 'a.png', mime: 'image/png', sizeBytes: 10 }).expect(201);
    const url = new URL(res.body.uploadUrl);
    await t.http().put(`${url.pathname}?exp=${url.searchParams.get('exp')}&sig=wrong`).set('Content-Type', 'image/png').send(Buffer.alloc(5)).expect(403);
    await t.http().put(`${url.pathname}${url.search}`).set('Content-Type', 'image/png').send(Buffer.alloc(50)).expect(413);
    const [file] = await t.db.select().from(s.files).where(eq(s.files.id, res.body.fileId));
    expect(file!.scanStatus).toBe('awaiting_upload');
    await m.post(`/uploads/${res.body.fileId}/complete`).expect(409);
  });

  it('rejects a renamed executable uploaded as .pdf (spec 4.5 acceptance) and notifies the owner', async () => {
    const m = await createMember(t);
    const id = await uploadBytes(t, m, { purpose: 'post_document', fileName: 'report.pdf', mime: 'application/pdf', data: fakeExe() });
    const res = await m.post(`/uploads/${id}/complete`).expect(200);
    expect(res.body.status).toBe('rejected');
    expect(res.body.rejectionReason).toMatch(/don’t match/);
    expect(res.body.url).toBeNull();
    await m.get(`/media/${id}`).expect(404);
    const notes = (await m.get('/notifications').expect(200)).body.items;
    expect(notes[0].type).toBe('upload_rejected');
    expect(notes[0].segments.map((x: { text: string }) => x.text).join('')).toContain('report.pdf');
    // A rejected file can't be attached.
    await m.post('/posts', { body: 'See attached', attachmentIds: [id] }).expect(422);
  });

  it('rejects text pretending to be a PDF', async () => {
    const m = await createMember(t);
    const id = await uploadBytes(t, m, { purpose: 'post_document', fileName: 'notes.pdf', mime: 'application/pdf', data: Buffer.from('just some text, not a pdf') });
    expect((await m.post(`/uploads/${id}/complete`).expect(200)).body.status).toBe('rejected');
  });

  it('rejects the EICAR test file as infected', async () => {
    const m = await createMember(t);
    const data = Buffer.from(`%PDF-1.4\n${EICAR}\n%%EOF\n`, 'latin1');
    const id = await uploadBytes(t, m, { purpose: 'post_document', fileName: 'eicar.pdf', mime: 'application/pdf', data });
    const res = await m.post(`/uploads/${id}/complete`).expect(200);
    expect(res.body.status).toBe('rejected');
    expect(res.body.rejectionReason).toMatch(/malware/);
    const [file] = await t.db.select().from(s.files).where(eq(s.files.id, id));
    expect(file!.scanStatus).toBe('infected');
    const [audit] = await t.db.select().from(s.auditLog).where(eq(s.auditLog.targetId, id));
    expect(audit!.action).toBe('upload.infected');
  });

  it('re-encodes images: EXIF stripped, longest edge capped at 2048, sha256 recorded', async () => {
    const m = await createMember(t);
    const original = await jpegWithExif(3000, 1000);
    expect((await sharp(original).metadata()).exif).toBeDefined();
    const id = await uploadBytes(t, m, { purpose: 'post_image', fileName: 'kigali.JPG', mime: 'image/jpeg', data: original });
    const res = await m.post(`/uploads/${id}/complete`).expect(200);
    expect(res.body).toMatchObject({ status: 'clean', mime: 'image/jpeg', width: 2048, height: 683 });
    expect(res.body.url).toContain(`/media/${id}`);

    const served = await m.get(`/media/${id}`).buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(served.status).toBe(200);
    expect(served.headers['content-type']).toBe('image/jpeg');
    expect(served.headers['x-content-type-options']).toBe('nosniff');
    expect(served.headers['content-disposition']).toMatch(/^inline/);
    expect(served.headers['cache-control']).toMatch(/private/);
    const meta = await sharp(served.body as Buffer).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.width).toBe(2048);
    expect((served.body as Buffer).toString('latin1')).not.toContain('secret-gps-owner');
    const [file] = await t.db.select().from(s.files).where(eq(s.files.id, id));
    expect(file!.sha256).toMatch(/^[0-9a-f]{64}$/);

    // Members-only: visitors get 401.
    await t.http().get(`/api/v1/media/${id}`).expect(401);
  });

  it('serves clean PDFs as attachments', async () => {
    const m = await createMember(t);
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n', 'latin1');
    const id = await uploadBytes(t, m, { purpose: 'post_document', fileName: 'guide.pdf', mime: 'application/pdf', data: pdf });
    expect((await m.post(`/uploads/${id}/complete`).expect(200)).body.status).toBe('clean');
    const res = await m.get(`/media/${id}`).expect(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="guide.pdf"/);
  });

  it('a post with a pending attachment is visible only to its author until the file is clean', async () => {
    const author = await createMember(t, { name: 'Amara Okafor' });
    const other = await createMember(t, { handle: 'kwame-mensah-x' });
    const id = await uploadBytes(t, author, { purpose: 'post_image', fileName: 'photo.png', mime: 'image/png', data: await png() });
    const post = await createPost(author, 'Look at this @kwame-mensah-x', { attachmentIds: [id] });
    expect(post.status).toBe('pending_media');
    expect(post.attachments).toHaveLength(1);
    await other.get(`/posts/${post.id}`).expect(404);
    expect((await other.get('/feed?tab=latest').expect(200)).body.items.some((p: { id: string }) => p.id === post.id)).toBe(false);
    expect((await author.get('/feed?tab=latest').expect(200)).body.items.some((p: { id: string }) => p.id === post.id)).toBe(true);
    // No mention notification while the post is not visible.
    expect((await other.get('/notifications').expect(200)).body.items).toHaveLength(0);
    // The same file can't be attached twice.
    await author.post('/posts', { body: 'Again', attachmentIds: [id] }).expect(422);

    expect((await author.post(`/uploads/${id}/complete`).expect(200)).body.status).toBe('clean');
    const visible = await other.get(`/posts/${post.id}`).expect(200);
    expect(visible.body.status).toBe('published');
    expect(visible.body.attachments[0]).toMatchObject({ kind: 'image', mime: 'image/png', width: 8, height: 8 });
    const notes = (await other.get('/notifications').expect(200)).body.items;
    expect(notes.some((n: { type: string }) => n.type === 'mention')).toBe(true);
  });

  it('a rejected attachment is dropped and the rest of the post is published', async () => {
    const author = await createMember(t);
    const other = await createMember(t);
    const id = await uploadBytes(t, author, { purpose: 'post_document', fileName: 'x.pdf', mime: 'application/pdf', data: fakeExe() });
    const post = await createPost(author, 'Report attached', { attachmentIds: [id] });
    expect(post.status).toBe('pending_media');
    await author.post(`/uploads/${id}/complete`).expect(200);
    const view = await other.get(`/posts/${post.id}`).expect(200);
    expect(view.body.status).toBe('published');
    expect(view.body.attachments).toEqual([]);
  });

  it('enforces attachment rules: own files only, up to 4 images or 1 document', async () => {
    const a = await createMember(t);
    const b = await createMember(t);
    const mine: string[] = [];
    for (let i = 0; i < 5; i++) {
      const id = await uploadBytes(t, a, { purpose: 'post_image', fileName: `p${i}.png`, mime: 'image/png', data: await png() });
      await a.post(`/uploads/${id}/complete`).expect(200);
      mine.push(id);
    }
    await a.post('/posts', { body: 'Too many', attachmentIds: mine }).expect(422);
    await b.post('/posts', { body: 'Not mine', attachmentIds: [mine[0]] }).expect(422);
    const pdf = await uploadBytes(t, a, { purpose: 'post_document', fileName: 'd.pdf', mime: 'application/pdf', data: Buffer.from('%PDF-1.4\n%%EOF\n') });
    await a.post(`/uploads/${pdf}/complete`).expect(200);
    await a.post('/posts', { body: 'Mixed', attachmentIds: [mine[0], pdf] }).expect(422);
    const ok = await createPost(a, 'Four photos', { attachmentIds: mine.slice(0, 4) });
    expect(ok.status).toBe('published');
    expect(ok.attachments).toHaveLength(4);
  });
});
