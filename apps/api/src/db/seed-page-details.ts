import { eq, inArray } from 'drizzle-orm';
import type { Db } from './client.js';
import * as s from './schema.js';
import type { SeedContext } from './seed-data.js';

/*
 * Demo page details (development and staging only): contact and business details, sectors and
 * specialties for the seeded pages, a few products for the company pages (no pictures) and two
 * enquiries waiting for a reply. Run after seedPages. Skipped once any product exists.
 */

const DAY = 86_400_000;
const ago = (days: number, hours = 0) => new Date(Date.now() - days * DAY - hours * 3_600_000);

type Details = {
  contactEmail: string;
  contactPhone: string | null;
  whatsapp: string | null;
  address: string;
  hours: string;
  foundedYear: number;
  teamSize: string;
  /** Sector names from SECTORS. */
  sectors: string[];
  specialties: string[];
  socialLinks: Record<string, string>;
  products: { name: string; description: string; price: string | null; link: string | null; active?: boolean }[];
};

const DETAILS: Record<string, Details> = {
  'charter-mission-updates': {
    contactEmail: 'hello@example.com',
    contactPhone: null,
    whatsapp: null,
    address: 'Dubai Internet City, Dubai, United Arab Emirates',
    hours: 'Sun–Thu 9:00–18:00 (GST)',
    foundedYear: 2025,
    teamSize: '11-50',
    sectors: ['Social impact', 'Technology'],
    specialties: ['Community building', 'Chapters', 'Ambassador programme', 'Diaspora networks'],
    socialLinks: {
      linkedin: 'https://example.com/linkedin/charter-mission',
      x: 'https://example.com/x/chartermission',
      youtube: 'https://example.com/youtube/chartermission',
    },
    products: [],
  },
  'lagos-agrihub': {
    contactEmail: 'hello@lagos-agrihub.example.com',
    contactPhone: '+234 1 700 4410',
    whatsapp: '+234 803 555 0142',
    address: '14 Ikorodu Road, Maryland, Lagos, Nigeria',
    hours: 'Mon–Sat 7:00–18:00',
    foundedYear: 2021,
    teamSize: '11-50',
    sectors: ['Agriculture & food', 'Trade & logistics'],
    specialties: ['Cold-chain logistics', 'Produce aggregation', 'Export readiness', 'Co-operative finance'],
    socialLinks: {
      linkedin: 'https://example.com/linkedin/lagos-agrihub',
      instagram: 'https://example.com/instagram/lagosagrihub',
      facebook: 'https://example.com/facebook/lagosagrihub',
    },
    products: [
      {
        name: 'Cold-room crate slot',
        description: 'Space for one crate in a shared cold room at 2–4 °C, booked by the week. Rooms in Ikorodu, Agbara and Mile 12. Drop off and collect any day from 7:00 to 18:00.',
        price: 'NGN 1,500 / crate / week',
        link: 'https://example.com/lagos-agrihub/cold-rooms',
      },
      {
        name: 'Farm-gate pickup',
        description: 'Refrigerated pickup from your farm or aggregation point to our nearest cold room. Within 120 km of Lagos; booked at least two days ahead.',
        price: 'From NGN 25,000 per trip',
        link: null,
      },
      {
        name: 'Co-op storage plan',
        description: 'Reserved cold-room space for a co-operative, with monthly stock reports and priority pickups during harvest.',
        price: 'NGN 120,000 / month',
        link: null,
      },
      {
        name: 'Export readiness check',
        description: 'A half-day visit by our trade team: grading, packaging, labelling and paperwork checked against what buyers in Ghana, Côte d’Ivoire and the UK ask for.',
        price: null,
        link: null,
      },
      {
        name: 'Solar dryer rental',
        description: 'Solar dryers for cassava, pepper and tomato, rented by the season. Coming in time for the 2027 dry season.',
        price: 'NGN 45,000 / season',
        link: null,
        active: false,
      },
    ],
  },
  paybridge: {
    contactEmail: 'support@paybridge.example.com',
    contactPhone: '+233 30 290 1144',
    whatsapp: '+233 24 555 0187',
    address: '6th Floor, Airport City, Accra, Ghana',
    hours: 'Mon–Fri 8:00–18:00 (GMT)',
    foundedYear: 2022,
    teamSize: '11-50',
    sectors: ['Finance & fintech', 'Trade & logistics'],
    specialties: ['Cross-border payments', 'Mobile money', 'FX settlement', 'Exporter onboarding'],
    socialLinks: {
      linkedin: 'https://example.com/linkedin/paybridge',
      x: 'https://example.com/x/paybridge',
    },
    products: [
      {
        name: 'Exporter settlement account',
        description: 'One account to receive payments from buyers across West and East Africa, with mobile money in and local currency out. Opened in a day with your business registration.',
        price: 'Free to open',
        link: 'https://example.com/paybridge/accounts',
      },
      {
        name: 'Cedi–naira settlement',
        description: 'Send and receive between Ghana and Nigeria, cleared in under an hour on weekdays. The rate is shown before you confirm.',
        price: '0.8% per transfer',
        link: 'https://example.com/paybridge/cedi-naira',
      },
      {
        name: 'Invoice collections',
        description: 'Send invoices with a payment link; buyers pay by card, bank or mobile money and you are paid in cedis.',
        price: 'From USD 49 / month',
        link: null,
      },
    ],
  },
  'greengrid-africa': {
    contactEmail: 'projects@greengrid.example.com',
    contactPhone: '+27 11 555 0193',
    whatsapp: null,
    address: '22 Juta Street, Braamfontein, Johannesburg, South Africa',
    hours: 'Mon–Fri 8:30–17:00',
    foundedYear: 2019,
    teamSize: '2-10',
    sectors: ['Climate & energy', 'Infrastructure'],
    specialties: ['Solar micro-grids', 'Clinic power', 'Installer training'],
    socialLinks: { linkedin: 'https://example.com/linkedin/greengrid-africa' },
    products: [
      {
        name: 'Clinic solar kit',
        description: 'A 5 kW solar and battery system sized for a rural clinic: lights, fridge for vaccines and a small lab. Installed and maintained for two years.',
        price: 'From ZAR 145,000',
        link: null,
      },
      {
        name: 'Village micro-grid study',
        description: 'Site visit, load survey and a costed design for a village micro-grid, ready to take to funders.',
        price: null,
        link: null,
      },
    ],
  },
};

type DemoEnquiry = { page: string; from: string; product?: string; message: string; daysAgo: number };

const ENQUIRIES: DemoEnquiry[] = [
  {
    page: 'lagos-agrihub',
    from: 'leila',
    product: 'Export readiness check',
    message:
      'Hello, I advise a group of pepper growers in Ogun who want to ship to Morocco next year. Could your trade team do the readiness check for about 12 farms at once, and roughly what would it cost?',
    daysAgo: 1,
  },
  {
    page: 'paybridge',
    from: 'fatou',
    product: 'Exporter settlement account',
    message:
      'Hi PayBridge team, two companies I back in Dakar export shea butter to Ghana. Can a Senegalese business open a settlement account yet, and which documents would they need?',
    daysAgo: 2,
  },
];

export async function seedPageDetails(db: Db, ctx: SeedContext) {
  const [existing] = await db.select({ id: s.pageProducts.id }).from(s.pageProducts).limit(1);
  if (existing) return;
  const id = (key: string) => ctx.ids[key];
  const pageRows = await db
    .select({ id: s.pages.id, slug: s.pages.slug, createdBy: s.pages.createdBy })
    .from(s.pages)
    .where(inArray(s.pages.slug, Object.keys(DETAILS)));
  if (!pageRows.length) return;
  const sectorRows = await db.select({ id: s.sectors.id, name: s.sectors.name }).from(s.sectors);
  const sectorId = new Map(sectorRows.map((r) => [r.name, r.id]));
  const productIds = new Map<string, string>();

  for (const page of pageRows) {
    const d = DETAILS[page.slug]!;
    await db
      .update(s.pages)
      .set({
        contactEmail: d.contactEmail,
        contactPhone: d.contactPhone,
        whatsapp: d.whatsapp,
        address: d.address,
        hours: d.hours,
        foundedYear: d.foundedYear,
        teamSize: d.teamSize,
        specialties: d.specialties,
        socialLinks: d.socialLinks,
      })
      .where(eq(s.pages.id, page.id));
    const sectors = d.sectors.flatMap((name) => (sectorId.get(name) ? [{ pageId: page.id, sectorId: sectorId.get(name)! }] : []));
    if (sectors.length) await db.insert(s.pageSectors).values(sectors).onConflictDoNothing();
    if (d.products.length) {
      const created = await db
        .insert(s.pageProducts)
        .values(
          d.products.map((p, position) => ({
            pageId: page.id,
            name: p.name,
            description: p.description,
            price: p.price,
            link: p.link,
            active: p.active ?? true,
            position,
            createdBy: page.createdBy,
            createdAt: ago(20 - position),
          })),
        )
        .returning({ id: s.pageProducts.id, name: s.pageProducts.name });
      for (const p of created) productIds.set(`${page.slug}:${p.name}`, p.id);
    }
  }

  const pageId = new Map(pageRows.map((p) => [p.slug, p.id]));
  const enquiries = ENQUIRIES.flatMap((e) => {
    const from = id(e.from);
    const page = pageId.get(e.page);
    if (!from || !page) return [];
    const aboutId = e.product ? productIds.get(`${e.page}:${e.product}`) : undefined;
    return [{ pageId: page, fromId: from, aboutType: aboutId ? 'product' : null, aboutId: aboutId ?? null, message: e.message, createdAt: ago(e.daysAgo, 2) }];
  });
  if (enquiries.length) await db.insert(s.pageEnquiries).values(enquiries);
}
