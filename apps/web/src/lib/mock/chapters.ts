/*
 * Chapter placeholder content from the Figma "Web / Chapter page" (18:2157).
 * Shapes mirror what the API will return.
 */
import type { AvatarTone } from "@chartermission/ui";
import type { InitiativeUpdate } from "./initiatives";

export type ChapterEvent = {
  slug: string;
  month: string;
  day: string;
  title: string;
  meta: string;
};

export type Chapter = {
  slug: string;
  name: string;
  city: string;
  location: string;
  members: number;
  meets: string;
  about: string;
  team: { name: string; handle: string; role: string; tone: AvatarTone }[];
  memberPreview: { name: string; handle: string; headline: string; location: string; verified?: boolean }[];
  events: ChapterEvent[];
  initiativesCount: number;
  posts: InitiativeUpdate[];
  stats: { label: string; value: string }[];
  nearby: { name: string; slug?: string }[];
};

export const chapters: Chapter[] = [
  {
    slug: "lagos",
    name: "Lagos Chapter",
    city: "Lagos",
    location: "Lagos, Nigeria",
    members: 2140,
    meets: "Meets monthly · Yaba",
    about:
      "The Lagos chapter brings together founders, engineers, investors and policy people working on Nigeria's next decade of growth. We meet on the second Saturday of every month at the Yaba tech hub, run working groups on agritech, fintech and trade, and host visiting diaspora members.",
    team: [
      { name: "Amara Okafor", handle: "amara-okafor", role: "Chapter lead", tone: "accent" },
      { name: "Tunde Bakare", handle: "tunde-bakare", role: "Events coordinator", tone: "success" },
      { name: "Ifeoma Adeyemi", handle: "ifeoma-adeyemi", role: "Membership & welcome", tone: "info" },
    ],
    memberPreview: [
      { name: "Amara Okafor", handle: "amara-okafor", headline: "Founder, Lagos AgriHub", location: "Lagos, Nigeria", verified: true },
      { name: "Tunde Bakare", handle: "tunde-bakare", headline: "Backend engineer", location: "Lagos, Nigeria", verified: true },
      { name: "Ifeoma Adeyemi", handle: "ifeoma-adeyemi", headline: "Community manager", location: "Lagos, Nigeria" },
      { name: "Chinedu Eze", handle: "chinedu-eze", headline: "Product designer", location: "London, UK" },
      { name: "Bisi Adebayo", handle: "bisi-adebayo", headline: "Fintech analyst", location: "Lagos, Nigeria" },
      { name: "Emeka Nwosu", handle: "emeka-nwosu", headline: "Logistics manager", location: "Apapa, Nigeria" },
    ],
    events: [
      { slug: "lagos-november-meetup", month: "NOV", day: "14", title: "November meet-up", meta: "Yaba tech hub · 86 going" },
      { slug: "women-in-leadership-circle", month: "DEC", day: "03", title: "Women in Leadership Circle", meta: "Hybrid · 210 going" },
      { slug: "lagos-december-meetup", month: "DEC", day: "12", title: "December meet-up & year in review", meta: "Yaba tech hub · 41 going" },
      { slug: "agritech-working-group", month: "JAN", day: "09", title: "Agritech working group", meta: "Online · 27 going" },
    ],
    initiativesCount: 6,
    posts: [
      {
        id: "november-meetup",
        pinned: "Pinned by chapter lead",
        author: { name: "Amara Okafor", verified: true, tone: "accent", href: "/members/amara-okafor" },
        meta: "Chapter lead · 2d",
        body: "November meet-up: Saturday 14 Nov, 3pm at the Yaba tech hub. Agenda: Farm-to-Port update, two founder lightning talks, and open networking. RSVP on the Events tab.",
        tags: ["LagosChapter"],
        stats: "188 reactions · 41 comments",
      },
      {
        id: "informal-payments",
        author: { name: "Tunde Bakare", verified: true, tone: "success", href: "/members/tunde-bakare" },
        meta: "Backend engineer · 6h",
        body: "Anyone in the chapter working on payments for informal traders? Would love to compare notes on USSD vs app-based flows.",
        tags: ["Fintech", "LagosChapter"],
        stats: "42 reactions · 17 comments",
      },
    ],
    stats: [
      { label: "New members", value: "+128" },
      { label: "Posts", value: "342" },
      { label: "Event registrations", value: "296" },
      { label: "Initiatives recruiting", value: "2" },
    ],
    nearby: [{ name: "Abuja" }, { name: "Ibadan" }, { name: "Accra" }, { name: "Cotonou" }, { name: "London diaspora" }],
  },
  {
    slug: "nairobi",
    name: "Nairobi Chapter",
    city: "Nairobi",
    location: "Nairobi, Kenya",
    members: 1685,
    meets: "Meets monthly · Westlands",
    about:
      "The Nairobi chapter is home to members working on climate, clean energy, health and fintech across East Africa. We meet on the last Saturday of every month in Westlands and run the annual clean-cooking hackathon.",
    team: [
      { name: "Wanjiru Kamau", handle: "wanjiru-kamau", role: "Chapter lead", tone: "info" },
      { name: "Achieng Otieno", handle: "achieng-otieno", role: "Events coordinator", tone: "success" },
      { name: "Daniel Mwangi", handle: "daniel-mwangi", role: "Membership & welcome", tone: "warning" },
    ],
    memberPreview: [
      { name: "Wanjiru Kamau", handle: "wanjiru-kamau", headline: "Climate Policy Analyst", location: "Nairobi, Kenya" },
      { name: "Achieng Otieno", handle: "achieng-otieno", headline: "Community outreach", location: "Nairobi, Kenya" },
      { name: "Daniel Mwangi", handle: "daniel-mwangi", headline: "Carbon accountant", location: "Nairobi, Kenya" },
      { name: "Kibet Langat", handle: "kibet-langat", headline: "Hardware engineer", location: "Eldoret, Kenya", verified: true },
    ],
    events: [
      { slug: "clean-cooking-hackathon", month: "NOV", day: "28", title: "Clean Cooking Hackathon", meta: "Westlands · 64 going" },
      { slug: "nairobi-december-meetup", month: "DEC", day: "19", title: "December meet-up", meta: "Westlands · 38 going" },
    ],
    initiativesCount: 3,
    posts: [
      {
        id: "hackathon-mentors",
        pinned: "Pinned by chapter lead",
        author: { name: "Wanjiru Kamau", tone: "info", href: "/members/wanjiru-kamau" },
        meta: "Chapter lead · 8h",
        body: "Our clean-cooking hackathon is on 28 November. Looking for 3 more mentors with hardware or carbon-finance experience — reply or DM if you can give a Saturday.",
        tags: ["ClimateAction", "NairobiChapter"],
        stats: "96 reactions · 31 comments",
      },
    ],
    stats: [
      { label: "New members", value: "+74" },
      { label: "Posts", value: "198" },
      { label: "Event registrations", value: "152" },
      { label: "Initiatives recruiting", value: "1" },
    ],
    nearby: [{ name: "Kampala" }, { name: "Kigali" }, { name: "Addis Ababa" }, { name: "Lagos", slug: "lagos" }],
  },
];

export function getChapter(slug: string): Chapter | undefined {
  return chapters.find((chapter) => chapter.slug === slug);
}
