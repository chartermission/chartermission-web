import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { EnquiryView, PageDetail, ProductView, PRODUCTS_MAX_PER_PAGE } from '@chartermission/contracts';
import { createMember, createTestApp, lastEmail, s, type TestApp } from '../helpers.js';
import { notificationsFor, resetLimits } from '../auth/support.js';
import { SettingsService } from '../../src/infra/settings.service.js';

type Member = Awaited<ReturnType<typeof createMember>>;

describe('Page details, products and enquiries', () => {
  let t: TestApp;
  let staff: Member;
  let amara: Member;
  let tunde: Member;
  let kwame: Member;
  let leila: Member;
  let fatou: Member;
  let sectorIds: string[];
  let pageId: string;

  beforeAll(async () => {
    t = await createTestApp();
    staff = await createMember(t, { name: 'Platform Admin', roles: ['platform_admin'], admin: true });
    amara = await createMember(t, { name: 'Amara Okafor', countryCode: 'NG' });
    tunde = await createMember(t, { name: 'Tunde Bakare', countryCode: 'NG' });
    kwame = await createMember(t, { name: 'Kwame Mensah', countryCode: 'GH' });
    leila = await createMember(t, { name: 'Leila Benali', countryCode: 'MA' });
    fatou = await createMember(t, { name: 'Fatou Diallo', countryCode: 'SN' });
    sectorIds = (await t.db.select({ id: s.sectors.id }).from(s.sectors).orderBy(s.sectors.position)).map((r) => r.id);
  });
  afterAll(() => t.close());
  beforeEach(() => resetLimits());

  const setPolicy = async (memberCreation: 'open' | 'review' | 'closed') => {
    await t.app.get(SettingsService).set('pages', { memberCreation, maxPagesPerMember: 5 }, null);
  };

  /** A clean upload owned by `ownerId`, as the media pipeline leaves it. */
  const upload = async (ownerId: string, purpose = 'product_image', scanStatus = 'clean') => {
    const id = randomUUID();
    await t.db.insert(s.files).values({ id, ownerId, purpose, storageKey: `uploads/${purpose}/${id}`, declaredMime: 'image/png', mime: 'image/png', sizeBytes: 1024, scanStatus });
    return id;
  };

  const product = (name: string, extra: object = {}) => ({ name, description: `${name}, described.`, price: 'USD 10', ...extra });

  describe('details and the creation policy', () => {
    it('pages go live at once by default (no saved setting)', async () => {
      await t.db.delete(s.platformSettings).where(eq(s.platformSettings.key, 'pages'));
      t.app.get(SettingsService).clearCache();
      expect((await kwame.get('/pages/settings').expect(200)).body).toMatchObject({ memberCreation: 'open' });
      const created = await kwame.post('/pages', { name: 'PayBridge', category: 'company' }).expect(201);
      expect(created.body).toMatchObject({ slug: 'paybridge', status: 'active', viewer: { role: 'owner', canPost: true } });
      expect((await leila.get('/pages/paybridge').expect(200)).body.status).toBe('active');
      expect((await staff.get('/admin/queues').expect(200)).body).toMatchObject({ pages: 0 });
    });

    it('saves contact and business details on create and returns them to everyone', async () => {
      const created = await amara
        .post('/pages', {
          name: 'Lagos AgriHub',
          category: 'company',
          contactEmail: 'Hello@AgriHub.Example',
          contactPhone: '+234 1 700 4410',
          whatsapp: '+234 803 555 0142',
          address: '14 Ikorodu Road, Lagos',
          hours: 'Mon–Sat 7:00–18:00',
          foundedYear: 2021,
          teamSize: '11-50',
          sectorIds: [sectorIds[1], sectorIds[0], sectorIds[1]],
          specialties: ['Cold-chain logistics', 'cold-chain  LOGISTICS', 'Export readiness'],
          socialLinks: { linkedin: 'https://example.com/in/agrihub', x: null, tiktok: 'https://example.com/tiktok' },
        })
        .expect(201);
      const page = PageDetail.parse(created.body);
      pageId = page.id;
      expect(page).toMatchObject({
        status: 'active',
        contactEmail: 'hello@agrihub.example',
        contactPhone: '+234 1 700 4410',
        whatsapp: '+234 803 555 0142',
        address: '14 Ikorodu Road, Lagos',
        hours: 'Mon–Sat 7:00–18:00',
        foundedYear: 2021,
        teamSize: '11-50',
        specialties: ['Cold-chain logistics', 'Export readiness'],
        socialLinks: { linkedin: 'https://example.com/in/agrihub', x: null, facebook: null, instagram: null, youtube: null },
        productCount: 0,
        serviceCount: 0,
        newEnquiries: 0,
      });
      // Sectors without repeats, in catalogue order.
      expect(page.sectors.map((x) => x.id)).toEqual([sectorIds[0], sectorIds[1]]);
      const [stored] = await t.db.select({ links: s.pages.socialLinks }).from(s.pages).where(eq(s.pages.id, page.id));
      expect(stored!.links).toEqual({ linkedin: 'https://example.com/in/agrihub' });

      const seen = PageDetail.parse((await kwame.get('/pages/lagos-agrihub').expect(200)).body);
      expect(seen).toMatchObject({ contactEmail: 'hello@agrihub.example', foundedYear: 2021, viewer: { role: null } });
      expect(seen.newEnquiries).toBeUndefined();
      expect(seen.admins).toBeUndefined();
      await amara.post('/pages/lagos-agrihub/admins', { handle: tunde.handle }).expect(200);
    });

    it('validates details', async () => {
      const bad = async (body: object, field: string) => {
        const res = await amara.patch('/pages/lagos-agrihub', body).expect(422);
        expect(Object.keys(res.body.error.fields ?? {})).toContain(field);
      };
      await bad({ sectorIds: [randomUUID()] }, 'sectorIds');
      await bad({ sectorIds: sectorIds.slice(0, 4) }, 'sectorIds');
      await bad({ contactPhone: 'call us' }, 'contactPhone');
      await bad({ contactEmail: 'not-an-email' }, 'contactEmail');
      await bad({ foundedYear: 1700 }, 'foundedYear');
      await bad({ teamSize: '5' }, 'teamSize');
      await bad({ specialties: Array.from({ length: 11 }, (_, i) => `Skill ${i}`) }, 'specialties');
      const res = await amara.patch('/pages/lagos-agrihub', { socialLinks: { linkedin: 'ftp://example.com' } }).expect(422);
      expect(JSON.stringify(res.body.error.fields)).toContain('linkedin');
      // Unknown sectors fail on create too, and nothing is created.
      await amara.post('/pages', { name: 'Ghost Page', category: 'company', sectorIds: [randomUUID()] }).expect(422);
      await kwame.get('/pages/ghost-page').expect(404);
    });

    it('updates details: sectors are replaced, empty values clear, others stay', async () => {
      const res = await tunde
        .patch('/pages/lagos-agrihub', { sectorIds: [sectorIds[2]], contactEmail: null, address: '', specialties: [], socialLinks: { instagram: 'https://example.com/ig/agrihub' } })
        .expect(200);
      expect(res.body).toMatchObject({
        sectors: [{ id: sectorIds[2] }],
        contactEmail: null,
        address: null,
        specialties: [],
        socialLinks: { linkedin: null, instagram: 'https://example.com/ig/agrihub' },
        contactPhone: '+234 1 700 4410',
        foundedYear: 2021,
      });
      expect((await amara.patch('/pages/lagos-agrihub', { sectorIds: [] }).expect(200)).body.sectors).toEqual([]);
      await kwame.patch('/pages/lagos-agrihub', { hours: 'Always open' }).expect(403);

      // The admin console edits details too.
      const admin = await staff.patch(`/admin/pages/${pageId}`, { sectorIds: [sectorIds[0]], hours: 'Mon–Fri 8:00–17:00' }).expect(200);
      expect(admin.body.id).toBe(pageId);
      expect((await kwame.get('/pages/lagos-agrihub').expect(200)).body).toMatchObject({ sectors: [{ id: sectorIds[0] }], hours: 'Mon–Fri 8:00–17:00' });
    });

    it('counts the page’s live services', async () => {
      const base = { hostPageId: pageId, description: 'A service the page offers to members.' };
      await t.db.insert(s.services).values([
        { ...base, title: 'Live service' },
        { ...base, title: 'Hidden service', active: false },
        { ...base, title: 'Deleted service', deletedAt: new Date() },
      ]);
      expect((await kwame.get('/pages/lagos-agrihub').expect(200)).body.serviceCount).toBe(1);
    });

    it('the review policy still holds pages for staff approval; closed is staff only', async () => {
      await setPolicy('review');
      const pending = await leila.post('/pages', { name: 'Casablanca Trade Desk', category: 'organisation', foundedYear: 2018 }).expect(201);
      expect(pending.body).toMatchObject({ status: 'pending', foundedYear: 2018, viewer: { canPost: false } });
      await kwame.get('/pages/casablanca-trade-desk').expect(404);
      await kwame.get('/pages/casablanca-trade-desk/products').expect(404);
      expect((await staff.get('/admin/queues').expect(200)).body).toMatchObject({ pages: 1 });
      await staff.post(`/admin/pages/${pending.body.id}/status`, { action: 'approve' }).expect(200);
      expect((await kwame.get('/pages/casablanca-trade-desk').expect(200)).body.status).toBe('active');

      await setPolicy('closed');
      await leila.post('/pages', { name: 'Not Allowed', category: 'community' }).expect(403);
      await setPolicy('open');
      expect((await leila.post('/pages', { name: 'Allowed Again', category: 'community' }).expect(201)).body.status).toBe('active');
    });
  });

  describe('products', () => {
    let first: ProductView;
    let image: string;

    it('page admins add products; everyone sees the active ones, in order', async () => {
      await kwame.post('/pages/lagos-agrihub/products', product('Not mine')).expect(403);
      await amara.post('/pages/lagos-agrihub/products', { name: 'x' }).expect(422);

      image = await upload(amara.id);
      first = ProductView.parse(
        (await amara.post('/pages/lagos-agrihub/products', product('Cold-room crate slot', { imageFileIds: [image, image], link: 'https://example.com/slots' })).expect(201)).body,
      );
      expect(first).toMatchObject({ name: 'Cold-room crate slot', price: 'USD 10', active: true, position: 0, link: 'https://example.com/slots', page: { slug: 'lagos-agrihub' } });
      expect(first.imageUrls).toEqual([expect.stringMatching(new RegExp(`/media/${image}$`))]);

      const second = (await tunde.post('/pages/lagos-agrihub/products', { name: 'Export readiness check' }).expect(201)).body;
      expect(second).toMatchObject({ position: 1, description: '', price: null, imageUrls: [], link: null });
      await tunde.post('/pages/lagos-agrihub/products', product('Solar dryer rental', { active: false })).expect(201);
      await amara.post('/pages/lagos-agrihub/products', product('Farm-gate pickup', { position: 0 })).expect(201);

      const pub = (await kwame.get('/pages/lagos-agrihub/products').expect(200)).body as ProductView[];
      expect(pub.map((p) => p.name)).toEqual(['Cold-room crate slot', 'Farm-gate pickup', 'Export readiness check']);
      const mine = (await amara.get('/pages/lagos-agrihub/products').expect(200)).body as ProductView[];
      expect(mine.map((p) => p.name)).toContain('Solar dryer rental');
      expect((await kwame.get('/pages/lagos-agrihub').expect(200)).body.productCount).toBe(3);
      expect((await amara.get('/pages/lagos-agrihub').expect(200)).body.productCount).toBe(4);
    });

    it('only takes the caller’s own clean product pictures, up to the limit', async () => {
      const others = await upload(kwame.id);
      const logo = await upload(amara.id, 'page_logo');
      const pending = await upload(amara.id, 'product_image', 'pending');
      for (const id of [others, logo, pending, randomUUID()]) {
        const res = await amara.post('/pages/lagos-agrihub/products', product('Bad picture', { imageFileIds: [id] })).expect(422);
        expect(res.body.error.fields).toHaveProperty('imageFileIds');
      }
      const five = await Promise.all(Array.from({ length: 5 }, () => upload(amara.id)));
      await amara.post('/pages/lagos-agrihub/products', product('Too many', { imageFileIds: five })).expect(422);

      // Another admin can keep pictures already on the product, but only add their own.
      const mine = await upload(tunde.id);
      const edited = await tunde.patch(`/pages/lagos-agrihub/products/${first.id}`, product('Cold-room crate slot', { imageFileIds: [mine, image], price: 'USD 12' })).expect(200);
      expect(edited.body.imageUrls).toHaveLength(2);
      expect(edited.body).toMatchObject({ price: 'USD 12', position: 0 });
      await tunde.patch(`/pages/lagos-agrihub/products/${first.id}`, product('Cold-room crate slot', { imageFileIds: [others] })).expect(422);

      // A picture later found unsafe is no longer served.
      await t.db.update(s.files).set({ scanStatus: 'infected' }).where(eq(s.files.id, mine));
      const list = (await kwame.get('/pages/lagos-agrihub/products').expect(200)).body as ProductView[];
      expect(list.find((p) => p.id === first.id)!.imageUrls).toEqual([expect.stringContaining(image)]);
    });

    it('edits and deletes are for the page’s admins; ids from another page are not found', async () => {
      await kwame.patch(`/pages/lagos-agrihub/products/${first.id}`, product('Hijacked')).expect(403);
      await kwame.delete(`/pages/lagos-agrihub/products/${first.id}`).expect(403);
      await kwame.post('/pages/paybridge/products', product('Settlement account')).expect(201);
      await kwame.patch(`/pages/paybridge/products/${first.id}`, product('Moved')).expect(404);
      await amara.patch('/pages/lagos-agrihub/products/not-a-uuid', product('x y')).expect(404);

      const doomed = (await amara.post('/pages/lagos-agrihub/products', product('Short-lived')).expect(201)).body;
      await amara.delete(`/pages/lagos-agrihub/products/${doomed.id}`).expect(200);
      await amara.delete(`/pages/lagos-agrihub/products/${doomed.id}`).expect(404);

      // Pages staff can manage any page's products from the member app.
      const staffMember = await createMember(t, { name: 'Pages Staff', roles: ['platform_admin'] });
      await staffMember.patch(`/pages/lagos-agrihub/products/${first.id}`, product('Cold-room crate slot', { imageFileIds: [image] })).expect(200);
    });

    it('a page that isn’t live can’t change products, and its products are hidden from members', async () => {
      await staff.post(`/admin/pages/${pageId}/status`, { action: 'suspend', note: 'Checking ownership' }).expect(200);
      await kwame.get('/pages/lagos-agrihub/products').expect(404);
      expect((await amara.get('/pages/lagos-agrihub/products').expect(200)).body.length).toBeGreaterThan(0);
      await amara.post('/pages/lagos-agrihub/products', product('While suspended')).expect(409);
      await amara.patch(`/pages/lagos-agrihub/products/${first.id}`, product('While suspended')).expect(409);
      await staff.post(`/admin/pages/${pageId}/status`, { action: 'restore' }).expect(200);
      await kwame.get('/pages/lagos-agrihub/products').expect(200);
    });

    it(`stops at ${PRODUCTS_MAX_PER_PAGE} products per page`, async () => {
      const [pay] = await t.db.select().from(s.pages).where(eq(s.pages.slug, 'paybridge'));
      const existing = (await kwame.get('/pages/paybridge/products').expect(200)).body.length as number;
      await t.db.insert(s.pageProducts).values(Array.from({ length: PRODUCTS_MAX_PER_PAGE - existing }, (_, i) => ({ pageId: pay!.id, name: `Item ${i}`, position: i + 1 })));
      const res = await kwame.post('/pages/paybridge/products', product('One too many')).expect(409);
      expect(res.body.error.message).toBe(`A page can list up to ${PRODUCTS_MAX_PER_PAGE} products`);
    });
  });

  describe('enquiries', () => {
    let productId: string;
    let hiddenProductId: string;
    let serviceId: string;
    let firstEnquiry: EnquiryView;

    beforeAll(async () => {
      const list = (await amara.get('/pages/lagos-agrihub/products').expect(200)).body as ProductView[];
      productId = list.find((p) => p.name === 'Cold-room crate slot')!.id;
      hiddenProductId = list.find((p) => p.name === 'Solar dryer rental')!.id;
      const [svc] = await t.db.select({ id: s.services.id }).from(s.services).where(eq(s.services.title, 'Live service'));
      serviceId = svc!.id;
    });

    it('verified members enquire about a product; every admin is told by notification and email', async () => {
      const res = await kwame.post('/pages/lagos-agrihub/enquiries', { about: { type: 'product', id: productId }, message: 'Do you have space for 40 crates of tomatoes next week?' }).expect(201);
      firstEnquiry = EnquiryView.parse(res.body);
      expect(firstEnquiry).toMatchObject({
        page: { slug: 'lagos-agrihub' },
        from: { id: kwame.id },
        about: { type: 'product', id: productId, title: 'Cold-room crate slot' },
        status: 'new',
        conversationId: null,
        repliedBy: null,
      });

      for (const admin of [amara, tunde]) {
        const [n] = await notificationsFor(t, admin.id, 'page_enquiry');
        expect(n).toBeTruthy();
        expect(JSON.stringify(n!.data)).toContain('Cold-room crate slot');
        expect((n!.data as { href: string }).href).toBe('/pages/lagos-agrihub/enquiries');
        const mail = await lastEmail(t.db, admin.email);
        expect(mail).toMatchObject({ template: 'notification.page_enquiry', subject: 'New enquiry for Lagos AgriHub' });
        expect(mail!.textBody).toContain('Do you have space for 40 crates of tomatoes next week?');
        expect(mail!.textBody).toContain('Cold-room crate slot');
        expect(mail!.textBody).toContain('/pages/lagos-agrihub/enquiries');
      }
      expect(await notificationsFor(t, kwame.id, 'page_enquiry')).toHaveLength(0);
      expect((await amara.get('/pages/lagos-agrihub').expect(200)).body.newEnquiries).toBe(1);
    });

    it('checks who can enquire and what about', async () => {
      const msg = 'I would like to know more about this, please.';
      await amara.post('/pages/lagos-agrihub/enquiries', { message: msg }).expect(403);
      await tunde.post('/pages/lagos-agrihub/enquiries', { message: msg }).expect(403);
      const unverified = await createMember(t, { name: 'Not Verified', verified: false });
      await unverified.post('/pages/lagos-agrihub/enquiries', { message: msg }).expect(403);
      await leila.post('/pages/lagos-agrihub/enquiries', { message: 'Too short' }).expect(422);

      const bad = async (about: object) => {
        const res = await leila.post('/pages/lagos-agrihub/enquiries', { about, message: msg }).expect(422);
        expect(res.body.error.fields).toHaveProperty('about');
      };
      await bad({ type: 'product', id: hiddenProductId });
      await bad({ type: 'product', id: randomUUID() });
      await bad({ type: 'service', id: productId });
      const [payProduct] = await t.db.select({ id: s.pageProducts.id }).from(s.pageProducts).where(eq(s.pageProducts.name, 'Settlement account'));
      await bad({ type: 'product', id: payProduct!.id });
      const [deleted] = await t.db.select({ id: s.services.id }).from(s.services).where(eq(s.services.title, 'Deleted service'));
      await bad({ type: 'service', id: deleted!.id });

      const svc = await leila.post('/pages/lagos-agrihub/enquiries', { about: { type: 'service', id: serviceId }, message: msg }).expect(201);
      expect(svc.body.about).toEqual({ type: 'service', id: serviceId, title: 'Live service' });
      const general = await leila.post('/pages/lagos-agrihub/enquiries', { message: msg }).expect(201);
      expect(general.body.about).toBeNull();

      // Pages that aren't live take no enquiries.
      await kwame.post('/pages/casablanca-trade-desk/enquiries', { message: msg }).expect(201);
      await staff.post(`/admin/pages/${pageId}/status`, { action: 'suspend', note: 'Checking ownership' }).expect(200);
      await fatou.post('/pages/lagos-agrihub/enquiries', { message: msg }).expect(404);
      await staff.post(`/admin/pages/${pageId}/status`, { action: 'restore' }).expect(200);
    });

    it('blocked members can’t enquire', async () => {
      const blocked = await createMember(t, { name: 'Blocked Member' });
      await tunde.post(`/blocks/${blocked.id}`).expect(201);
      const res = await blocked.post('/pages/lagos-agrihub/enquiries', { message: 'Can I book a cold-room slot?' }).expect(403);
      expect(res.body.error.message).toBe('You can’t send this page an enquiry.');
    });

    it('limits unanswered enquiries per page and enquiries per day', async () => {
      const msg = 'Another question about your cold rooms, please.';
      // Kwame has one waiting already: two more are fine, a fourth is not.
      await kwame.post('/pages/lagos-agrihub/enquiries', { message: msg }).expect(201);
      await kwame.post('/pages/lagos-agrihub/enquiries', { message: msg }).expect(201);
      const res = await kwame.post('/pages/lagos-agrihub/enquiries', { message: msg }).expect(409);
      expect(res.body.error.message).toMatch(/3 enquiries waiting/);
      // Another page is still fine.
      await kwame.post('/pages/allowed-again/enquiries', { message: msg }).expect(201);

      // Ten a day in all: answered enquiries no longer count against the page limit, but still count for the day.
      const sent: string[] = [];
      for (let i = 0; i < 10; i++) {
        const r = await fatou.post('/pages/paybridge/enquiries', { message: `${msg} (${i + 1})` }).expect(201);
        sent.push(r.body.id);
        if (sent.length % 3 === 0) for (const id of sent.slice(-3)) await kwame.post(`/pages/paybridge/enquiries/${id}/close`).expect(200);
      }
      for (const id of sent.slice(9)) await kwame.post(`/pages/paybridge/enquiries/${id}/close`).expect(200);
      const limited = await fatou.post('/pages/allowed-again/enquiries', { message: msg }).expect(429);
      expect(limited.body.error.message).toBe('You can send 10 enquiries a day. Try again tomorrow.');
    });

    it('lists enquiries for the page’s admins only, newest first, by status and in pages', async () => {
      await kwame.get('/pages/lagos-agrihub/enquiries').expect(403);
      // Staff without a role on the page don't read its enquiries.
      const staffMember = await createMember(t, { name: 'Pages Staff Two', roles: ['platform_admin'] });
      await staffMember.get('/pages/lagos-agrihub/enquiries').expect(403);

      const all = (await amara.get('/pages/lagos-agrihub/enquiries').expect(200)).body;
      expect(all.items).toHaveLength(5);
      expect(all.items.at(-1).id).toBe(firstEnquiry.id);
      expect(all.nextCursor).toBeNull();
      const first = (await tunde.get('/pages/lagos-agrihub/enquiries?limit=2').expect(200)).body;
      expect(first.items).toHaveLength(2);
      const second = (await tunde.get(`/pages/lagos-agrihub/enquiries?limit=2&cursor=${first.nextCursor}`).expect(200)).body;
      expect(second.items.map((e: EnquiryView) => e.id)).toEqual(all.items.slice(2, 4).map((e: EnquiryView) => e.id));
      expect((await amara.get('/pages/lagos-agrihub/enquiries?status=closed').expect(200)).body.items).toHaveLength(0);
      expect((await amara.get('/pages/lagos-agrihub').expect(200)).body.newEnquiries).toBe(5);
    });

    it('a reply opens an active direct chat the member can answer, and is reused', async () => {
      await kwame.post(`/pages/lagos-agrihub/enquiries/${firstEnquiry.id}/reply`, { message: 'Me?' }).expect(403);
      await amara.post(`/pages/lagos-agrihub/enquiries/${firstEnquiry.id}/reply`, { message: '' }).expect(422);
      const res = await amara.post(`/pages/lagos-agrihub/enquiries/${firstEnquiry.id}/reply`, { message: 'Yes, we can take 40 crates from Monday.' }).expect(200);
      const replied = EnquiryView.parse(res.body);
      expect(replied).toMatchObject({ status: 'replied', repliedBy: { id: amara.id } });
      expect(replied.conversationId).toBeTruthy();
      const [row] = await t.db.select().from(s.pageEnquiries).where(eq(s.pageEnquiries.id, firstEnquiry.id));
      expect(row!.repliedAt).toBeTruthy();

      // Kwame and Amara aren't connected, yet the chat is active (not a request) and he can answer.
      const convo = (await kwame.get(`/messages/conversations/${replied.conversationId}`).expect(200)).body;
      expect(convo).toMatchObject({ status: 'active', canSend: true });
      const messages = (await kwame.get(`/messages/conversations/${replied.conversationId}/messages`).expect(200)).body.items;
      expect(messages.map((m: { body: string }) => m.body)).toContain('Yes, we can take 40 crates from Monday.');
      await kwame.post(`/messages/conversations/${replied.conversationId}/messages`, { body: 'Great, I will bring them on Monday.' }).expect(201);
      await kwame.post(`/messages/conversations/${replied.conversationId}/messages`, { body: 'And a few more on Tuesday.' }).expect(201);

      // The next reply to Kwame goes into the same chat.
      const [another] = (await amara.get('/pages/lagos-agrihub/enquiries?status=new').expect(200)).body.items.filter((e: EnquiryView) => e.from.id === kwame.id);
      const again = await amara.post(`/pages/lagos-agrihub/enquiries/${another.id}/reply`, { message: 'Answered in our chat.' }).expect(200);
      expect(again.body.conversationId).toBe(replied.conversationId);
      expect((await amara.get('/pages/lagos-agrihub').expect(200)).body.newEnquiries).toBe(3);
    });

    it('a reply opens up an earlier declined message request', async () => {
      // Tunde once sent Leila a message request, which she declined.
      const started = (await tunde.post('/messages/conversations', { memberId: leila.id }).expect(200)).body;
      await tunde.post(`/messages/conversations/${started.id}/messages`, { body: 'Hello Leila, can we talk trade?' }).expect(201);
      await leila.post(`/messages/conversations/${started.id}/decline`).expect(204);

      const [mine] = (await tunde.get('/pages/lagos-agrihub/enquiries?status=new').expect(200)).body.items.filter((e: EnquiryView) => e.from.id === leila.id);
      const res = await tunde.post(`/pages/lagos-agrihub/enquiries/${mine.id}/reply`, { message: 'Thanks for asking. Here are our rates.' }).expect(200);
      expect(res.body.conversationId).toBe(started.id);
      expect((await leila.get(`/messages/conversations/${started.id}`).expect(200)).body).toMatchObject({ status: 'active', canSend: true });
      await leila.post(`/messages/conversations/${started.id}/messages`, { body: 'Thank you, that helps.' }).expect(201);
    });

    it('admins close enquiries; closed ones take no reply', async () => {
      await kwame.post(`/pages/lagos-agrihub/enquiries/${firstEnquiry.id}/close`).expect(403);
      const closed = await tunde.post(`/pages/lagos-agrihub/enquiries/${firstEnquiry.id}/close`).expect(200);
      expect(closed.body).toMatchObject({ status: 'closed', repliedBy: { id: amara.id } });
      await tunde.post(`/pages/lagos-agrihub/enquiries/${firstEnquiry.id}/close`).expect(409);
      await amara.post(`/pages/lagos-agrihub/enquiries/${firstEnquiry.id}/reply`, { message: 'One more thing' }).expect(409);
      expect((await amara.get('/pages/lagos-agrihub/enquiries?status=closed').expect(200)).body.items.map((e: EnquiryView) => e.id)).toEqual([firstEnquiry.id]);
      // An enquiry of another page is not found here.
      const [other] = (await kwame.get('/pages/paybridge/enquiries').expect(200)).body.items;
      await amara.post(`/pages/lagos-agrihub/enquiries/${other.id}/close`).expect(404);
      await amara.post(`/pages/lagos-agrihub/enquiries/${randomUUID()}/reply`, { message: 'Hello' }).expect(404);
    });
  });
});
