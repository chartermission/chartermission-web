/*
 * Initiative placeholder content from the Figma "Web / Initiatives" (17:1868)
 * and "Web / Initiative detail" (18:1849) screens. Shapes mirror what the API
 * will return so the screens can switch to real data by replacing imports.
 */
import type { AvatarTone, ChipTone, PostCardProps } from "@chartermission/ui";
import type { InitiativeStatus } from "@chartermission/contracts";

/** Statuses shown in the member directory (subset of the contracts enum). */
export type DirectoryStatus = Extract<InitiativeStatus, "recruiting" | "active" | "completed">;

export const initiativeStatusMeta: Record<DirectoryStatus, { label: string; tone: ChipTone }> = {
  recruiting: { label: "Recruiting", tone: "success" },
  active: { label: "Active", tone: "info" },
  completed: { label: "Completed", tone: "neutral" },
};

export type Person = { name: string; handle: string; tone: AvatarTone };

export type InitiativeRole = { id: string; title: string; description: string; skills: string[] };

export type Milestone = { title: string; meta: string; state: "done" | "current" | "upcoming" };

export type TeamMember = Person & { role: string; lead?: boolean };

export type InitiativeUpdate = PostCardProps & { id: string };

export type Initiative = {
  slug: string;
  title: string;
  theme: string;
  status: DirectoryStatus;
  country: string;
  chapter?: { slug: string; name: string };
  /** Short card summary. */
  summary: string;
  /** Longer hero description on the detail page. */
  description: string;
  /** e.g. "Milestone 3 of 6 · Pilot hub live" */
  progressLabel: string;
  percent: number;
  lead: Person;
  collaborators: number;
  countries: number;
  followers: number;
  updatesCount: number;
  roles: InitiativeRole[];
  milestones: Milestone[];
  team: TeamMember[];
  updates: InitiativeUpdate[];
  related: { slug: string; title: string; meta: string }[];
};

const amara: Person = { name: "Amara Okafor", handle: "amara-okafor", tone: "accent" };
const wanjiru: Person = { name: "Wanjiru Kamau", handle: "wanjiru-kamau", tone: "info" };
const kwame: Person = { name: "Kwame Mensah", handle: "kwame-mensah", tone: "success" };
const yohannes: Person = { name: "Yohannes Tesfaye", handle: "yohannes-tesfaye", tone: "info" };
const leila: Person = { name: "Leila Benali", handle: "leila-benali", tone: "info" };
const fatou: Person = { name: "Fatou Diallo", handle: "fatou-diallo", tone: "accent" };

export const initiatives: Initiative[] = [
  {
    slug: "farm-to-port-lagos",
    title: "Farm-to-Port Lagos",
    theme: "Agriculture",
    status: "recruiting",
    country: "Nigeria",
    chapter: { slug: "nigeria", name: "Lagos chapter" },
    summary: "Cold-chain hubs that move smallholder produce from farm gate to Lagos ports in under 48 hours.",
    description:
      "Cold-chain hubs that move smallholder produce from farm gate to Lagos ports in under 48 hours — cutting post-harvest loss and opening export markets under AfCFTA.",
    progressLabel: "Milestone 3 of 6 · Pilot hub live",
    percent: 50,
    lead: amara,
    collaborators: 18,
    countries: 3,
    followers: 1204,
    updatesCount: 12,
    roles: [
      {
        id: "logistics-lead",
        title: "Cold-chain logistics lead",
        description: "Design routes and hub schedules for the pilot corridor. ~6 hrs/week.",
        skills: ["Logistics", "Ops"],
      },
      {
        id: "export-compliance",
        title: "Export compliance advisor",
        description: "Help growers meet EU and AfCFTA certification. ~3 hrs/week.",
        skills: ["Trade", "Certification"],
      },
      {
        id: "data-volunteer",
        title: "Data volunteer",
        description: "Build the loss-tracking dashboard. Remote. ~4 hrs/week.",
        skills: ["SQL", "Dashboards"],
      },
    ],
    milestones: [
      { title: "Partner farms signed", meta: "40 farms across Ogun and Oyo · Mar 2026", state: "done" },
      { title: "Hub site secured", meta: "Agbara industrial estate · Jun 2026", state: "done" },
      { title: "Pilot hub live", meta: "First produce shipped in 31 hours · Oct 2026", state: "done" },
      { title: "Second corridor", meta: "Ibadan → Apapa · target Jan 2027", state: "current" },
      { title: "Export certification", meta: "EU GlobalG.A.P. for 12 farms", state: "upcoming" },
      { title: "Scale to 3 hubs", meta: "Target Q3 2027", state: "upcoming" },
    ],
    team: [
      { ...amara, role: "Initiative lead · Lagos", lead: true },
      { name: "Chinedu Eze", handle: "chinedu-eze", tone: "success", role: "Product & design · London" },
      { name: "Thabo Nkosi", handle: "thabo-nkosi", tone: "warning", role: "Solar cold rooms · Johannesburg" },
      { ...leila, role: "Trade advisor · Casablanca" },
    ],
    updates: [
      {
        id: "milestone-3",
        author: { name: amara.name, verified: true, tone: amara.tone, href: `/${amara.handle}` },
        meta: "Update · Initiative lead · 3d",
        body: "Milestone 3 done ✅ Our first refrigerated truck reached Apapa in 31 hours with zero spoilage. Thank you to the 18 collaborators who made this happen.",
        image: { label: "Agbara pilot hub · first shipment" },
        tags: ["FarmToPort", "AgriTech", "AfCFTA"],
        stats: "412 reactions · 64 comments · 38 reposts",
      },
    ],
    related: [
      { slug: "export-readiness-grant", title: "Export Readiness Grant", meta: "SME fund · Closes 5 Dec" },
      { slug: "cold-chain-engineer-greengrid", title: "Cold Chain Engineer", meta: "GreenGrid Africa · Lagos · Full-time" },
    ],
  },
  {
    slug: "clean-cooking-nairobi",
    title: "Clean Cooking Nairobi",
    theme: "Climate",
    status: "active",
    country: "Kenya",
    chapter: { slug: "kenya", name: "Nairobi chapter" },
    summary: "Replacing charcoal stoves with LPG and ethanol in 5,000 Nairobi households, financed by carbon credits.",
    description:
      "Replacing charcoal stoves with LPG and ethanol in 5,000 Nairobi households, financed by verified carbon credits and a pay-as-you-cook model.",
    progressLabel: "Milestone 4 of 5 · 3,200 homes reached",
    percent: 80,
    lead: wanjiru,
    collaborators: 42,
    countries: 2,
    followers: 2310,
    updatesCount: 21,
    roles: [
      {
        id: "carbon-finance",
        title: "Carbon-finance analyst",
        description: "Prepare the next verification report with our registry partner. ~4 hrs/week.",
        skills: ["Carbon markets", "Excel"],
      },
      {
        id: "hardware-mentor",
        title: "Hardware mentor",
        description: "Coach hackathon teams on stove sensor prototypes. One Saturday.",
        skills: ["IoT", "Hardware"],
      },
    ],
    milestones: [
      { title: "Supplier partnerships", meta: "Two LPG distributors signed · Jan 2026", state: "done" },
      { title: "Pay-as-you-cook pilot", meta: "500 homes in Kibera · Apr 2026", state: "done" },
      { title: "Carbon credits verified", meta: "First issuance · Jul 2026", state: "done" },
      { title: "3,200 homes reached", meta: "Kibera, Mathare and Kawangware · Oct 2026", state: "current" },
      { title: "5,000 homes", meta: "Target Mar 2027", state: "upcoming" },
    ],
    team: [
      { ...wanjiru, role: "Initiative lead · Nairobi", lead: true },
      { name: "Achieng Otieno", handle: "achieng-otieno", tone: "success", role: "Community outreach · Nairobi" },
      { name: "Daniel Mwangi", handle: "daniel-mwangi", tone: "warning", role: "Carbon accounting · Nairobi" },
    ],
    updates: [
      {
        id: "homes-3200",
        author: { name: wanjiru.name, tone: wanjiru.tone, href: `/${wanjiru.handle}` },
        meta: "Update · Initiative lead · 1w",
        body: "3,200 households are now cooking without charcoal. Next stop: the clean-cooking hackathon on 28 November — we still need hardware mentors.",
        tags: ["CleanCooking", "ClimateAction"],
        stats: "268 reactions · 41 comments · 19 reposts",
      },
    ],
    related: [{ slug: "climate-innovation-fund", title: "Climate Innovation Fund", meta: "Grant · Closes 12 Jan" }],
  },
  {
    slug: "code-kumasi",
    title: "Code Kumasi",
    theme: "Education",
    status: "recruiting",
    country: "Ghana",
    summary: "Free weekend coding bootcamps for secondary-school girls in Kumasi, with diaspora mentors.",
    description:
      "Free weekend coding bootcamps for secondary-school girls in Kumasi, paired with diaspora mentors who meet them online every fortnight.",
    progressLabel: "Milestone 1 of 4 · Curriculum drafted",
    percent: 25,
    lead: kwame,
    collaborators: 9,
    countries: 3,
    followers: 486,
    updatesCount: 4,
    roles: [
      {
        id: "mentor",
        title: "Online mentor",
        description: "Meet two students every fortnight over video. ~2 hrs/month.",
        skills: ["Mentoring", "Web development"],
      },
      {
        id: "instructor",
        title: "Weekend instructor",
        description: "Teach Saturday sessions in Kumasi. ~4 hrs/week.",
        skills: ["Python", "Teaching"],
      },
    ],
    milestones: [
      { title: "Curriculum drafted", meta: "12-week Python track · Sep 2026", state: "done" },
      { title: "Venue and laptops", meta: "KNUST partnership · target Dec 2026", state: "current" },
      { title: "First cohort", meta: "40 students · Jan 2027", state: "upcoming" },
      { title: "Demo day", meta: "Target Apr 2027", state: "upcoming" },
    ],
    team: [
      { ...kwame, role: "Initiative lead · Accra", lead: true },
      { name: "Abena Owusu", handle: "abena-owusu", tone: "accent", role: "Curriculum · Kumasi" },
    ],
    updates: [
      {
        id: "curriculum",
        author: { name: kwame.name, verified: true, tone: kwame.tone, href: `/${kwame.handle}` },
        meta: "Update · Initiative lead · 2w",
        body: "The 12-week curriculum is drafted. We're now looking for weekend instructors and online mentors from the diaspora.",
        tags: ["WomenInTech", "Education"],
        stats: "94 reactions · 12 comments · 8 reposts",
      },
    ],
    related: [],
  },
  {
    slug: "telehealth-tigray-link",
    title: "Telehealth Tigray Link",
    theme: "Health",
    status: "active",
    country: "Ethiopia",
    summary: "Connecting rural clinics to specialists in Addis Ababa and the diaspora through low-bandwidth video.",
    description:
      "Connecting rural clinics to specialists in Addis Ababa and the diaspora through low-bandwidth video consultations and shared patient records.",
    progressLabel: "Milestone 2 of 5 · 14 clinics connected",
    percent: 40,
    lead: yohannes,
    collaborators: 27,
    countries: 4,
    followers: 912,
    updatesCount: 9,
    roles: [],
    milestones: [
      { title: "Platform selected", meta: "Works on 2G connections · Feb 2026", state: "done" },
      { title: "14 clinics connected", meta: "Mekelle and Adigrat districts · Aug 2026", state: "done" },
      { title: "Specialist rota", meta: "30 volunteer doctors · in progress", state: "current" },
      { title: "Shared records", meta: "Target Mar 2027", state: "upcoming" },
      { title: "40 clinics", meta: "Target Q4 2027", state: "upcoming" },
    ],
    team: [
      { ...yohannes, role: "Initiative lead · Addis Ababa", lead: true },
      { name: "Selam Haile", handle: "selam-haile", tone: "success", role: "Clinical lead · Mekelle" },
    ],
    updates: [],
    related: [],
  },
  {
    slug: "rules-of-origin-toolkit",
    title: "Rules of Origin Toolkit",
    theme: "Trade",
    status: "completed",
    country: "Morocco",
    summary: "A plain-language guide to AfCFTA rules of origin for first-time exporters, in English, French and Arabic.",
    description:
      "A plain-language guide to AfCFTA rules of origin for first-time exporters, published in English, French and Arabic with worked examples.",
    progressLabel: "6 of 6 milestones · Published",
    percent: 100,
    lead: leila,
    collaborators: 15,
    countries: 5,
    followers: 1730,
    updatesCount: 15,
    roles: [],
    milestones: [
      { title: "Research", meta: "Interviews with 30 exporters · Jan 2026", state: "done" },
      { title: "English draft", meta: "Mar 2026", state: "done" },
      { title: "French and Arabic editions", meta: "May 2026", state: "done" },
      { title: "Legal review", meta: "Jun 2026", state: "done" },
      { title: "Design and layout", meta: "Jul 2026", state: "done" },
      { title: "Published", meta: "Free download · Aug 2026", state: "done" },
    ],
    team: [
      { ...leila, role: "Initiative lead · Casablanca", lead: true },
      { name: "Youssef Amrani", handle: "youssef-amrani", tone: "warning", role: "Arabic edition · Rabat" },
    ],
    updates: [],
    related: [],
  },
  {
    slug: "diaspora-angels-network",
    title: "Diaspora Angels Network",
    theme: "Finance",
    status: "recruiting",
    country: "Senegal",
    summary: "A syndicate that lets diaspora professionals co-invest small tickets in early-stage African startups.",
    description:
      "A syndicate that lets diaspora professionals co-invest small tickets in early-stage African startups, with shared due diligence and pooled legal costs.",
    progressLabel: "Milestone 2 of 6 · Legal structure agreed",
    percent: 33,
    lead: fatou,
    collaborators: 31,
    countries: 6,
    followers: 2045,
    updatesCount: 7,
    roles: [
      {
        id: "due-diligence",
        title: "Due-diligence reviewer",
        description: "Review two deal memos a month. ~3 hrs/week.",
        skills: ["Venture", "Finance"],
      },
    ],
    milestones: [
      { title: "Founding members", meta: "25 angels committed · Jun 2026", state: "done" },
      { title: "Legal structure agreed", meta: "SPV in Mauritius · Sep 2026", state: "done" },
      { title: "Deal-flow partners", meta: "Three accelerators · in progress", state: "current" },
      { title: "First close", meta: "Target Jan 2027", state: "upcoming" },
      { title: "First investment", meta: "Target Mar 2027", state: "upcoming" },
      { title: "Second fund", meta: "Target 2028", state: "upcoming" },
    ],
    team: [
      { ...fatou, role: "Initiative lead · Dakar", lead: true },
      { name: "Moussa Ndiaye", handle: "moussa-ndiaye", tone: "info", role: "Legal · Paris" },
    ],
    updates: [],
    related: [],
  },
];

export function getInitiative(slug: string): Initiative | undefined {
  return initiatives.find((initiative) => initiative.slug === slug);
}

export const initiativeThemes = [...new Set(initiatives.map((i) => i.theme))].sort();
export const initiativeCountries = [...new Set(initiatives.map((i) => i.country))].sort();
