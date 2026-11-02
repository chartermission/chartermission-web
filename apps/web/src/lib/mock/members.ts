/*
 * Member profile placeholder content (Figma "Web / Member profile", node 9:860).
 * Shapes mirror what the profile API will return; contact visibility uses the
 * FieldVisibility enum from @chartermission/contracts.
 */
import type { AvatarTone, ChipTone } from "@chartermission/ui";
import type { FieldVisibility } from "@chartermission/contracts";

export type ContactField = {
  kind: "email" | "website" | "phone";
  /** Shown next to the visibility label when the field is public (e.g. the website domain). */
  value?: string;
  visibility: FieldVisibility;
};

export type MemberProfile = {
  handle: string;
  name: string;
  verified?: boolean;
  tone: AvatarTone;
  /** e.g. "Lagos chapter · Lead" */
  role?: string;
  headline: string;
  shortHeadline: string;
  location: string;
  diasporaLink?: string;
  connections: string;
  interests: string[];
  about: string;
  experience: { title: string; organisation: string; meta: string }[];
  contact: ContactField[];
  initiatives: { name: string; slug: string; status: string; statusTone: ChipTone; meta: string }[];
  chapters: { name: string; slug: string; meta: string }[];
  alsoViewed: string[];
};

export const members: Record<string, MemberProfile> = {
  "owais-iqbal": {
    handle: "owais-iqbal",
    name: "Owais Iqbal",
    tone: "primary",
    role: "Dubai chapter · Member",
    headline: "Founder · Building technology products for teams across the Gulf and Africa",
    shortHeadline: "Founder · Dubai, UAE",
    location: "Dubai, UAE",
    connections: "412",
    interests: ["Technology", "Diaspora investment"],
    about:
      "Founder working across the Gulf and Africa. Interested in connecting diaspora founders with operators back home and in technology for public-sector teams.",
    experience: [{ title: "Founder & CEO", organisation: "Technology company", meta: "2019 – present · Dubai, UAE" }],
    contact: [
      { kind: "email", visibility: "connections" },
      { kind: "website", visibility: "members" },
      { kind: "phone", visibility: "only_me" },
    ],
    initiatives: [],
    chapters: [{ name: "Dubai diaspora chapter", slug: "dubai", meta: "Member · 640 members" }],
    alsoViewed: ["amara-okafor", "fatou-diallo"],
  },
  "amara-okafor": {
    handle: "amara-okafor",
    name: "Amara Okafor",
    verified: true,
    tone: "accent",
    role: "Lagos chapter · Lead",
    headline: "Founder, Lagos AgriHub · Building climate-smart supply chains for West African smallholder farmers",
    shortHeadline: "Founder, Lagos AgriHub · Lagos chapter lead",
    location: "Lagos, Nigeria",
    diasporaLink: "London, UK",
    connections: "1,284",
    interests: ["Agriculture", "Trade", "Climate", "Supply chain"],
    about:
      "Agronomist turned founder. Lagos AgriHub connects 4,000+ smallholder farmers to cold storage and export buyers in Ghana, Côte d’Ivoire and the UK. Open to co-founders on the Farm-to-Port initiative and to mentoring early-stage agritech teams.",
    experience: [
      { title: "Founder & CEO", organisation: "Lagos AgriHub", meta: "2021 – present · Lagos, Nigeria" },
      { title: "Supply Chain Analyst", organisation: "Fresh produce importer", meta: "2016 – 2021 · London, UK" },
    ],
    contact: [
      { kind: "email", visibility: "connections" },
      { kind: "website", value: "lagosagrihub.ng", visibility: "public" },
      { kind: "phone", visibility: "only_me" },
    ],
    initiatives: [
      { name: "Farm-to-Port Lagos", slug: "farm-to-port-lagos", status: "Recruiting", statusTone: "success", meta: "Lead · 18 collaborators" },
      { name: "Cold Chain Africa", slug: "cold-chain-africa", status: "Active", statusTone: "info", meta: "Contributor · 42 collaborators" },
    ],
    chapters: [
      { name: "Lagos chapter", slug: "lagos", meta: "Chapter lead · 2,140 members" },
      { name: "London diaspora chapter", slug: "london", meta: "Member · 1,380 members" },
    ],
    alsoViewed: ["kwame-mensah", "thabo-nkosi"],
  },
  "kwame-mensah": {
    handle: "kwame-mensah",
    name: "Kwame Mensah",
    verified: true,
    tone: "success",
    role: "Accra chapter · Member",
    headline: "Product Lead, PayBridge · Making cross-border payments cheaper for the diaspora",
    shortHeadline: "Product Lead, PayBridge",
    location: "Accra, Ghana",
    diasporaLink: "Toronto, Canada",
    connections: "932",
    interests: ["Fintech", "Payments", "Diaspora investment"],
    about:
      "Product lead on PayBridge's remittance and diaspora investment products. Previously built payments infrastructure in Toronto. Happy to talk to founders about FX, compliance and getting to market in Ghana.",
    experience: [
      { title: "Product Lead", organisation: "PayBridge", meta: "2022 – present · Accra, Ghana" },
      { title: "Senior Product Manager", organisation: "Payments platform", meta: "2017 – 2022 · Toronto, Canada" },
    ],
    contact: [
      { kind: "email", visibility: "members" },
      { kind: "website", value: "paybridge.africa", visibility: "public" },
      { kind: "phone", visibility: "only_me" },
    ],
    initiatives: [
      { name: "Diaspora Investment Index", slug: "diaspora-investment-index", status: "Active", statusTone: "info", meta: "Lead · 11 collaborators" },
    ],
    chapters: [{ name: "Accra chapter", slug: "accra", meta: "Member · 1,920 members" }],
    alsoViewed: ["fatou-diallo", "amara-okafor"],
  },
  "wanjiru-kamau": {
    handle: "wanjiru-kamau",
    name: "Wanjiru Kamau",
    tone: "info",
    role: "Nairobi chapter · Organiser",
    headline: "Climate Policy Analyst · Clean cooking and adaptation finance in East Africa",
    shortHeadline: "Climate Policy Analyst",
    location: "Nairobi, Kenya",
    connections: "708",
    interests: ["Climate", "Energy", "Policy"],
    about:
      "Policy analyst focused on clean cooking and adaptation finance. Organising the Nairobi chapter's clean-cooking hackathon and always looking for mentors with hardware or carbon-finance experience.",
    experience: [{ title: "Climate Policy Analyst", organisation: "Regional policy institute", meta: "2020 – present · Nairobi, Kenya" }],
    contact: [
      { kind: "email", visibility: "connections" },
      { kind: "website", visibility: "members" },
      { kind: "phone", visibility: "only_me" },
    ],
    initiatives: [
      { name: "Clean Cooking Hackathon", slug: "clean-cooking-hackathon", status: "Recruiting", statusTone: "success", meta: "Organiser · 64 going" },
    ],
    chapters: [{ name: "Nairobi chapter", slug: "nairobi", meta: "Organiser · 2,610 members" }],
    alsoViewed: ["thabo-nkosi", "yohannes-tesfaye"],
  },
  "thabo-nkosi": {
    handle: "thabo-nkosi",
    name: "Thabo Nkosi",
    tone: "warning",
    headline: "Renewable energy engineer · Mini-grids and cold-chain power",
    shortHeadline: "Renewable energy engineer",
    location: "Johannesburg, South Africa",
    connections: "514",
    interests: ["Energy", "Engineering", "Climate"],
    about: "Engineer designing solar mini-grids for farms and cold storage. Interested in cold-chain projects across Southern and East Africa.",
    experience: [{ title: "Renewable Energy Engineer", organisation: "Mini-grid developer", meta: "2018 – present · Johannesburg, South Africa" }],
    contact: [
      { kind: "email", visibility: "members" },
      { kind: "website", visibility: "only_me" },
      { kind: "phone", visibility: "only_me" },
    ],
    initiatives: [{ name: "Cold Chain Africa", slug: "cold-chain-africa", status: "Active", statusTone: "info", meta: "Contributor · 42 collaborators" }],
    chapters: [{ name: "Johannesburg chapter", slug: "johannesburg", meta: "Member · 1,210 members" }],
    alsoViewed: ["wanjiru-kamau", "amara-okafor"],
  },
  "fatou-diallo": {
    handle: "fatou-diallo",
    name: "Fatou Diallo",
    verified: true,
    tone: "accent",
    role: "Dakar chapter · Member",
    headline: "Fintech investor · Early-stage funding for West African founders",
    shortHeadline: "Fintech investor · Dakar",
    location: "Dakar, Senegal",
    diasporaLink: "Paris, France",
    connections: "2,046",
    interests: ["Fintech", "Venture capital", "Women in leadership"],
    about: "Early-stage investor backing fintech and climate founders in francophone West Africa. Office hours every other Friday for Charter Mission members.",
    experience: [
      { title: "Partner", organisation: "Early-stage fund", meta: "2020 – present · Dakar, Senegal" },
      { title: "Associate", organisation: "Investment bank", meta: "2015 – 2020 · Paris, France" },
    ],
    contact: [
      { kind: "email", visibility: "connections" },
      { kind: "website", value: "fatoudiallo.vc", visibility: "public" },
      { kind: "phone", visibility: "only_me" },
    ],
    initiatives: [],
    chapters: [
      { name: "Dakar chapter", slug: "dakar", meta: "Member · 980 members" },
      { name: "Paris diaspora chapter", slug: "paris", meta: "Member · 1,120 members" },
    ],
    alsoViewed: ["kwame-mensah", "yohannes-tesfaye"],
  },
  "yohannes-tesfaye": {
    handle: "yohannes-tesfaye",
    name: "Yohannes Tesfaye",
    tone: "info",
    headline: "Health-tech founder · Digital records for community clinics",
    shortHeadline: "Health-tech founder · Addis Ababa",
    location: "Addis Ababa, Ethiopia",
    connections: "388",
    interests: ["Health", "Technology"],
    about: "Building digital patient records for community clinics in Ethiopia. Looking for engineers and clinicians who want to contribute to open health standards.",
    experience: [{ title: "Founder", organisation: "Community health records startup", meta: "2022 – present · Addis Ababa, Ethiopia" }],
    contact: [
      { kind: "email", visibility: "members" },
      { kind: "website", visibility: "public" },
      { kind: "phone", visibility: "only_me" },
    ],
    initiatives: [],
    chapters: [{ name: "Addis Ababa chapter", slug: "addis-ababa", meta: "Member · 760 members" }],
    alsoViewed: ["fatou-diallo", "kwame-mensah"],
  },
};

export const memberHandles = Object.keys(members);
