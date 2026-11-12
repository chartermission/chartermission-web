import { eq } from 'drizzle-orm';
import { createMember, createTestApp, s, type TestApp } from '../helpers.js';
import { resetLimits } from '../auth/support.js';
import { insertEvent } from '../events/event-helpers.js';

describe('Invitations by email', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());
  beforeEach(() => resetLimits());

  it('emails an invitation to a chapter with the member’s note and a link back', async () => {
    const amara = await createMember(t, { name: 'Amara Inviter' });
    const [chapter] = await t.db.select({ slug: s.chapters.slug }).from(s.chapters).limit(1);
    const res = await amara.post('/invites', { emails: ['friend@example.org', 'FRIEND@example.org', amara.email], chapterSlug: chapter!.slug, message: 'Come build with us' }).expect(200);
    expect(res.body).toEqual({ sent: 1 });
    const [mail] = await t.db.select().from(s.emailOutbox).where(eq(s.emailOutbox.toAddress, 'friend@example.org'));
    expect(mail).toMatchObject({ template: 'invite.chapter' });
    expect(mail!.subject).toContain('Amara Inviter invited you');
    expect(mail!.textBody).toContain('Come build with us');
    expect(mail!.textBody).toContain(`/invite?chapter=${chapter!.slug}&from=`);

    await amara.post('/invites', { emails: ['not-an-email'] }).expect(422);
    await amara.post('/invites', { emails: [amara.email] }).expect(422);
    await amara.post('/invites', { emails: ['x@example.org'], chapterSlug: 'no-such-chapter' }).expect(404);
  });

  it('emails an invitation to an event, linking to it', async () => {
    const host = await createMember(t, { name: 'Host Person' });
    const event = await insertEvent(t, host.id, { startsAt: new Date(Date.now() + 5 * 86400_000), slug: 'invite-me-summit' });
    await host.post('/invites', { emails: ['guest@example.org'], eventSlug: event.slug, message: 'See you there' }).expect(200);
    const [mail] = await t.db.select().from(s.emailOutbox).where(eq(s.emailOutbox.toAddress, 'guest@example.org'));
    expect(mail).toMatchObject({ template: 'invite.event' });
    expect(mail!.textBody).toContain('/invite?event=invite-me-summit&from=');
    await host.post('/invites', { emails: ['x@example.org'], eventSlug: 'no-such-event' }).expect(404);
  });
});
