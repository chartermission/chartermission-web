import { eq } from 'drizzle-orm';
import { DEFAULT_FIELD_VISIBILITY, MemberProfile, OwnProfile, PROFILE_CERTIFICATIONS_MAX, type FieldVisibilityMap } from '@chartermission/contracts';
import { createMember, createTestApp, s, type TestApp } from '../helpers.js';
import { resetLimits } from '../auth/support.js';
import { MediaService } from '../../src/media/media.service.js';

type Member = Awaited<ReturnType<typeof createMember>>;

/** PrivacySettingsInput.fieldVisibility is a complete map (zod 4 enum-keyed record). */
const vis = (overrides: FieldVisibilityMap | Record<string, string>) => ({ ...DEFAULT_FIELD_VISIBILITY, ...overrides });

const pmp = { name: 'Project Management Professional (PMP)', issuer: 'Project Management Institute', issueDate: '2023-04', expiryDate: '2026-04', credentialId: '3418827', credentialUrl: 'https://www.example.org/verify/3418827' };
const ielts = { name: 'IELTS Academic', issuer: 'British Council', issueDate: '2022-01', expiryDate: '2024-01' };
const cpa = { name: 'Certified Public Accountant (CPA)', issuer: 'Institute of Certified Public Accountants of Kenya' };

async function connect(a: Member, b: Member) {
  const req = await a.post('/connections', { memberId: b.id }).expect(201);
  await b.post(`/connections/${req.body.id}/accept`).expect(200);
}

describe('Profiles: licenses & certifications', () => {
  let t: TestApp;
  let examSeq = 0;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await resetLimits();
  });

  /** An issued Charter Center certificate for `m`, with an image (as exam-certificates.service stores one). */
  async function issuedCertificate(
    m: Member,
    opts: { courseTitle?: string | null; examTitle?: string; issuedAt?: Date; externalId?: string | null; status?: string } = {},
  ) {
    examSeq += 1;
    const [exam] = await t.db
      .insert(s.exams)
      .values({ slug: `cert-exam-${examSeq}`, title: opts.examTitle ?? `Exam ${examSeq}`, status: 'published', publishedAt: new Date() })
      .returning();
    const [image] = await t.db
      .insert(s.files)
      .values({ ownerId: m.id, purpose: 'post_image', mime: 'image/jpeg', declaredMime: 'image/jpeg', originalName: 'certificate.jpg', sizeBytes: 4, storageKey: `uploads/post_image/cert-${examSeq}`, scanStatus: 'clean' })
      .returning();
    await t.app.get(MediaService).storage.write(image!.storageKey, Buffer.from('jpeg'), 'image/jpeg');
    const [cert] = await t.db
      .insert(s.examCertificates)
      .values({
        examId: exam!.id,
        userId: m.id,
        status: opts.status ?? 'issued',
        externalId: opts.externalId === undefined ? `CC-${examSeq}-2026` : opts.externalId,
        request: opts.courseTitle === null ? null : { course_title: opts.courseTitle ?? `Certificate ${examSeq}`, student_name: m.name },
        imageFileId: image!.id,
        issuedAt: opts.status && opts.status !== 'issued' ? null : (opts.issuedAt ?? new Date('2026-03-15T10:00:00Z')),
      })
      .returning();
    return { exam: exam!, image: image!, cert: cert! };
  }

  /** The certificate shared to the feed, as a public post carrying its image. */
  async function sharePost(m: Member, certId: string, imageId: string) {
    const [post] = await t.db.insert(s.posts).values({ authorId: m.id, body: 'I passed!', visibility: 'public', type: 'celebration' }).returning();
    await t.db.insert(s.postAttachments).values({ postId: post!.id, fileId: imageId, kind: 'image' });
    await t.db.update(s.examCertificates).set({ postId: post!.id }).where(eq(s.examCertificates.id, certId));
    return post!;
  }

  it('adds, replaces, orders and clears the member’s own certifications', async () => {
    const m = await createMember(t, { name: 'Cert Owner' });
    const empty = OwnProfile.parse((await m.get('/me/profile').expect(200)).body);
    expect(empty.certifications).toEqual([]);
    expect(empty.examCertifications).toEqual([]);

    const added = OwnProfile.parse(
      (await m.patch('/me/profile', { certifications: [pmp, { ...ielts, credentialId: '  ', credentialUrl: null }] }).expect(200)).body,
    );
    expect(added.certifications.map((c) => c.name)).toEqual([pmp.name, ielts.name]);
    expect(added.certifications[0]).toMatchObject({ ...pmp, id: expect.any(String) });
    // Blank optional text is stored as nothing.
    expect(added.certifications[1]).toMatchObject({ credentialId: null, credentialUrl: null, issueDate: '2022-01', expiryDate: '2024-01' });

    // Replace-all keeps the order given; names and issuers are trimmed.
    const reordered = OwnProfile.parse(
      (await m.patch('/me/profile', { certifications: [{ ...cpa, name: `  ${cpa.name}  ` }, ielts, pmp] }).expect(200)).body,
    );
    expect(reordered.certifications.map((c) => c.name)).toEqual([cpa.name, ielts.name, pmp.name]);
    expect(reordered.certifications[0]).toMatchObject({ issueDate: null, expiryDate: null, credentialId: null, credentialUrl: null });
    expect((await m.get('/me/profile').expect(200)).body.certifications.map((c: { name: string }) => c.name)).toEqual([cpa.name, ielts.name, pmp.name]);

    // Other PATCHes leave them alone.
    await m.patch('/me/profile', { bio: 'Accountant.' }).expect(200);
    expect((await m.get('/me/profile').expect(200)).body.certifications).toHaveLength(3);

    const viewer = await createMember(t, { name: 'Cert Viewer' });
    const seen = MemberProfile.parse((await viewer.get(`/members/${m.handle}`).expect(200)).body);
    expect(seen.certifications!.map((c) => [c.name, c.verified, c.imageUrl])).toEqual([
      [cpa.name, false, null],
      [ielts.name, false, null],
      [pmp.name, false, null],
    ]);

    const cleared = OwnProfile.parse((await m.patch('/me/profile', { certifications: [] }).expect(200)).body);
    expect(cleared.certifications).toEqual([]);
    expect((await viewer.get(`/members/${m.handle}`).expect(200)).body.certifications).toEqual([]);
  });

  it('refuses invalid certifications (422)', async () => {
    const m = await createMember(t, { name: 'Cert Validator' });
    const bad = async (item: Record<string, unknown>) => (await m.patch('/me/profile', { certifications: [item] }).expect(422)).body.error;
    expect(JSON.stringify(await bad({ ...pmp, issueDate: '2024-05', expiryDate: '2024-04' }))).toContain('expiry date');
    await bad({ ...pmp, credentialUrl: 'javascript:alert(1)' });
    await bad({ ...pmp, credentialUrl: 'ftp://x' });
    await bad({ ...pmp, credentialUrl: 'example.org/verify' });
    await bad({ ...pmp, name: 'P' });
    await bad({ ...pmp, issuer: ' ' });
    await bad({ ...pmp, issueDate: '2024-13' });
    await bad({ ...pmp, issueDate: '2024-1' });
    const tooMany = Array.from({ length: PROFILE_CERTIFICATIONS_MAX + 1 }, (_, i) => ({ ...cpa, name: `Certificate number ${i + 1}` }));
    await m.patch('/me/profile', { certifications: tooMany }).expect(422);
    // The same expiry and issue month is fine; so is exactly the maximum.
    await m.patch('/me/profile', { certifications: [{ ...pmp, issueDate: '2024-05', expiryDate: '2024-05' }] }).expect(200);
    await m.patch('/me/profile', { certifications: tooMany.slice(0, PROFILE_CERTIFICATIONS_MAX) }).expect(200);
    expect((await m.get('/me/profile').expect(200)).body.certifications).toHaveLength(PROFILE_CERTIFICATIONS_MAX);
  });

  it('follows the "certifications" field visibility', async () => {
    const owner = await createMember(t, { name: 'Private Certs' });
    const friend = await createMember(t, { name: 'Cert Friend' });
    const stranger = await createMember(t, { name: 'Cert Stranger' });
    await connect(owner, friend);
    await owner.patch('/me/profile', { certifications: [pmp] }).expect(200);
    const { cert } = await issuedCertificate(owner);

    // Default: members.
    expect(OwnProfile.parse((await owner.get('/me/profile').expect(200)).body).fieldVisibility.certifications).toBe('members');
    expect((await stranger.get(`/members/${owner.handle}`).expect(200)).body.certifications).toHaveLength(2);

    await owner.put('/me/privacy', { profileVisibility: 'public', fieldVisibility: vis({ certifications: 'members' }) }).expect(200);
    expect(await t.http().get(`/api/v1/members/${owner.handle}`).expect(200).then((r) => r.body)).not.toHaveProperty('certifications');

    await owner.put('/me/privacy', { profileVisibility: 'public', fieldVisibility: vis({ certifications: 'connections' }) }).expect(200);
    expect((await stranger.get(`/members/${owner.handle}`).expect(200)).body).not.toHaveProperty('certifications');
    expect((await friend.get(`/members/${owner.handle}`).expect(200)).body.certifications.map((c: { id: string }) => c.id)).toEqual([
      cert.id,
      expect.any(String),
    ]);
    expect((await owner.get('/me/profile/preview?as=member').expect(200)).body).not.toHaveProperty('certifications');
    expect((await owner.get('/me/profile/preview?as=connection').expect(200)).body.certifications).toHaveLength(2);

    await owner.put('/me/privacy', { profileVisibility: 'public', fieldVisibility: vis({ certifications: 'only_me' }) }).expect(200);
    for (const viewer of [stranger, friend]) expect((await viewer.get(`/members/${owner.handle}`).expect(200)).body).not.toHaveProperty('certifications');
    expect((await owner.get(`/members/${owner.handle}`).expect(200)).body.certifications).toHaveLength(2);
    // Hidden from the profile, still in the editor.
    const own = OwnProfile.parse((await owner.get('/me/profile').expect(200)).body);
    expect(own.certifications).toHaveLength(1);
    expect(own.examCertifications).toHaveLength(1);
  });

  it('shows Charter Mission exam certificates as verified, first, newest first; the member can hide them', async () => {
    const m = await createMember(t, { name: 'Exam Passer' });
    const viewer = await createMember(t, { name: 'Exam Viewer' });
    const other = await createMember(t, { name: 'Other Passer' });
    await m.patch('/me/profile', { certifications: [ielts] }).expect(200);
    const older = await issuedCertificate(m, { courseTitle: 'Diploma in Trade Policy', issuedAt: new Date('2025-12-31T23:30:00Z') });
    const newer = await issuedCertificate(m, { courseTitle: null, examTitle: 'Climate Finance Basics', issuedAt: new Date('2026-06-01T08:00:00Z'), externalId: null });
    await issuedCertificate(m, { status: 'pending' });
    await issuedCertificate(m, { status: 'failed' });
    const post = await sharePost(m, older.cert.id, older.image.id);
    const othersCert = await issuedCertificate(other);

    const own = OwnProfile.parse((await m.get('/me/profile').expect(200)).body);
    expect(own.examCertifications).toEqual([
      {
        id: newer.cert.id,
        name: 'Climate Finance Basics',
        issuer: 'Charter Center',
        issueDate: '2026-06',
        expiryDate: null,
        credentialId: null,
        credentialUrl: null,
        verified: true,
        imageUrl: `/api/v1/media/${newer.image.id}`,
        shown: true,
      },
      {
        id: older.cert.id,
        name: 'Diploma in Trade Policy',
        issuer: 'Charter Center',
        issueDate: '2025-12',
        expiryDate: null,
        credentialId: older.cert.externalId,
        credentialUrl: `/posts/${post.id}`,
        verified: true,
        imageUrl: `/api/v1/media/${older.image.id}`,
        shown: true,
      },
    ]);
    expect(own.certifications.map((c) => c.name)).toEqual([ielts.name]);

    const seen = MemberProfile.parse((await viewer.get(`/members/${m.handle}`).expect(200)).body);
    expect(seen.certifications!.map((c) => [c.id, c.verified])).toEqual([
      [newer.cert.id, true],
      [older.cert.id, true],
      [own.certifications[0]!.id, false],
    ]);
    expect(seen.certifications![0]).not.toHaveProperty('shown');
    expect(seen.certifications![0]!.imageUrl).toBe(`/api/v1/media/${newer.image.id}`);

    // A deleted post is no longer the credential link.
    await t.db.update(s.posts).set({ deletedAt: new Date() }).where(eq(s.posts.id, post.id));
    expect((await m.get('/me/profile').expect(200)).body.examCertifications[1].credentialUrl).toBeNull();
    await t.db.update(s.posts).set({ deletedAt: null }).where(eq(s.posts.id, post.id));

    // Hide one; someone else's certificate id is ignored (and stays shown for them).
    const hid = OwnProfile.parse((await m.patch('/me/profile', { hiddenExamCertificateIds: [older.cert.id, othersCert.cert.id] }).expect(200)).body);
    expect(hid.examCertifications.map((c) => [c.id, c.shown])).toEqual([
      [newer.cert.id, true],
      [older.cert.id, false],
    ]);
    const [othersRow] = await t.db.select().from(s.examCertificates).where(eq(s.examCertificates.id, othersCert.cert.id));
    expect(othersRow!.shownOnProfile).toBe(true);
    expect((await viewer.get(`/members/${other.handle}`).expect(200)).body.certifications.map((c: { id: string }) => c.id)).toEqual([othersCert.cert.id]);

    const afterHide = MemberProfile.parse((await viewer.get(`/members/${m.handle}`).expect(200)).body);
    expect(afterHide.certifications!.map((c) => c.id)).toEqual([newer.cert.id, own.certifications[0]!.id]);
    expect((await m.get(`/members/${m.handle}`).expect(200)).body.certifications.map((c: { id: string }) => c.id)).toEqual([newer.cert.id, own.certifications[0]!.id]);

    // Leaving hiddenExamCertificateIds out changes nothing; a new list replaces the old one.
    await m.patch('/me/profile', { bio: 'Hello' }).expect(200);
    expect((await m.get('/me/profile').expect(200)).body.examCertifications.map((c: { shown: boolean }) => c.shown)).toEqual([true, false]);
    const swapped = OwnProfile.parse((await m.patch('/me/profile', { hiddenExamCertificateIds: [newer.cert.id.toUpperCase()] }).expect(200)).body);
    expect(swapped.examCertifications.map((c) => c.shown)).toEqual([false, true]);
    const none = OwnProfile.parse((await m.patch('/me/profile', { hiddenExamCertificateIds: [] }).expect(200)).body);
    expect(none.examCertifications.map((c) => c.shown)).toEqual([true, true]);
    await m.patch('/me/profile', { hiddenExamCertificateIds: ['not-a-uuid'] }).expect(422);
  });

  it('gives visitors a certificate image only when they may load it (a public post carries it)', async () => {
    const m = await createMember(t, { name: 'Public Passer' });
    const shared = await issuedCertificate(m, { issuedAt: new Date('2026-05-01T00:00:00Z') });
    const unshared = await issuedCertificate(m, { issuedAt: new Date('2026-04-01T00:00:00Z') });
    await sharePost(m, shared.cert.id, shared.image.id);
    await m.put('/me/privacy', { profileVisibility: 'public', fieldVisibility: vis({ certifications: 'public' }) }).expect(200);

    const guest = MemberProfile.parse((await t.http().get(`/api/v1/members/${m.handle}`).expect(200)).body);
    expect(guest.certifications!.map((c) => [c.id, c.imageUrl])).toEqual([
      [shared.cert.id, `/api/v1/media/${shared.image.id}`],
      [unshared.cert.id, null],
    ]);
    // The same as GET /media allows a visitor.
    expect((await t.http().get(`/api/v1/media/${shared.image.id}`)).status).toBe(200);
    await t.http().get(`/api/v1/media/${unshared.image.id}`).expect(401);
    const preview = MemberProfile.parse((await m.get('/me/profile/preview?as=public').expect(200)).body);
    expect(preview.certifications!.map((c) => c.imageUrl)).toEqual([`/api/v1/media/${shared.image.id}`, null]);

    // Signed-in members may load either.
    const member = await createMember(t, { name: 'Signed In Viewer' });
    const asMember = MemberProfile.parse((await member.get(`/members/${m.handle}`).expect(200)).body);
    expect(asMember.certifications!.map((c) => c.imageUrl)).toEqual([`/api/v1/media/${shared.image.id}`, `/api/v1/media/${unshared.image.id}`]);

    // A members-only post isn't for visitors.
    const [post] = await t.db.select().from(s.examCertificates).where(eq(s.examCertificates.id, shared.cert.id));
    await t.db.update(s.posts).set({ visibility: 'members' }).where(eq(s.posts.id, post!.postId!));
    expect((await t.http().get(`/api/v1/members/${m.handle}`).expect(200)).body.certifications[0].imageUrl).toBeNull();
  });
});
