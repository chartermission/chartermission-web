import { eq } from 'drizzle-orm';
import { createMember, createTestApp, s, type TestApp } from '../helpers.js';
import { resetLimits } from '../auth/support.js';

describe('Chapter members page', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());
  beforeEach(() => resetLimits());

  it('lists only the chapter’s members, searchable, without hidden or blocked members', async () => {
    const [chapter] = await t.db.select({ id: s.chapters.id, slug: s.chapters.slug }).from(s.chapters).where(eq(s.chapters.status, 'active')).limit(1);
    const viewer = await createMember(t, { name: 'Viewer Person' });
    const inside = await createMember(t, { name: 'Zainab Insider' });
    const hidden = await createMember(t, { name: 'Zainab Hidden' });
    const outside = await createMember(t, { name: 'Zainab Outsider' });
    for (const m of [inside, hidden]) await m.post('/follows', { targetType: 'chapter', targetId: chapter!.slug }).expect(201);
    await t.db.update(s.memberProfiles).set({ discoverable: false }).where(eq(s.memberProfiles.userId, hidden.id));

    const ids = (body: { items: { id: string }[] }) => body.items.map((m) => m.id);
    const all = (await viewer.get(`/members?chapter=${chapter!.slug}&q=Zainab`).expect(200)).body;
    expect(ids(all)).toContain(inside.id);
    expect(ids(all)).not.toContain(hidden.id);
    expect(ids(all)).not.toContain(outside.id);
    expect(all.items.find((m: { id: string }) => m.id === inside.id).relationship).toBeTruthy();

    await viewer.get(`/members?chapter=no-such-chapter`).expect(200).expect(({ body }) => expect(body.items).toEqual([]));
  });
});
