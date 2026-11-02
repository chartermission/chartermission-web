/*
 * Network directory placeholder content (Figma "Web / Network directory",
 * node 17:1602). The first six members are the ones shown in the design for
 * its default filters (South Africa · Energy & climate · Solar · mentoring).
 */
import type { AvatarTone } from "@chartermission/ui";

export type ConnectionState = "none" | "pending" | "connected";

export type DirectoryMember = {
  handle: string;
  name: string;
  verified?: boolean;
  headline: string;
  location: string;
  country: string;
  sector: string;
  chapter: string;
  skills: string[];
  mutual: number;
  tone: AvatarTone;
  connection: ConnectionState;
  following?: boolean;
  openToMentoring?: boolean;
  openToCollaborate?: boolean;
  diaspora?: boolean;
};

export const networkCountries = [
  { value: "", label: "Any country" },
  { value: "GH", label: "Ghana" },
  { value: "KE", label: "Kenya" },
  { value: "MA", label: "Morocco" },
  { value: "NG", label: "Nigeria" },
  { value: "SN", label: "Senegal" },
  { value: "ZA", label: "South Africa" },
  { value: "GB", label: "United Kingdom" },
] as const;

export const networkSectors = [
  { value: "", label: "Any sector" },
  { value: "energy-climate", label: "Energy & climate" },
  { value: "fintech", label: "Fintech" },
  { value: "agriculture", label: "Agriculture" },
  { value: "design", label: "Design & product" },
  { value: "trade", label: "Trade & policy" },
] as const;

export const networkChapters = [
  { value: "", label: "Any chapter" },
  { value: "johannesburg", label: "Johannesburg" },
  { value: "cape-town", label: "Cape Town" },
  { value: "nairobi", label: "Nairobi" },
  { value: "lagos", label: "Lagos" },
  { value: "accra", label: "Accra" },
  { value: "london", label: "London" },
] as const;

/** Skill chips offered in the filter panel before the member adds their own. */
export const suggestedSkills = ["Solar", "Grid finance", "Policy"];

export const networkDefaults = {
  country: "ZA",
  sector: "energy-climate",
  chapter: "",
  skills: ["Solar"],
  openToMentoring: true,
  openToCollaborate: false,
  diaspora: false,
};

export const networkTabs = [
  { value: "discover", label: "Discover" },
  { value: "connections", label: "My connections", count: 412 },
  { value: "requests", label: "Requests", count: 3 },
  { value: "following", label: "Following", count: 96 },
] as const;

export type NetworkTab = (typeof networkTabs)[number]["value"];

export const directoryMembers: DirectoryMember[] = [
  {
    handle: "thabo-nkosi",
    name: "Thabo Nkosi",
    verified: true,
    headline: "Renewable energy engineer at GreenGrid Africa",
    location: "Johannesburg, South Africa",
    country: "ZA",
    sector: "energy-climate",
    chapter: "johannesburg",
    skills: ["Solar", "Grid finance"],
    mutual: 12,
    tone: "warning",
    connection: "none",
    openToMentoring: true,
    openToCollaborate: true,
  },
  {
    handle: "nomsa-mahlangu",
    name: "Nomsa Mahlangu",
    verified: true,
    headline: "Solar mini-grid developer · Mentor",
    location: "Pretoria, South Africa",
    country: "ZA",
    sector: "energy-climate",
    chapter: "johannesburg",
    skills: ["Solar"],
    mutual: 8,
    tone: "success",
    connection: "none",
    openToMentoring: true,
  },
  {
    handle: "kofi-asante",
    name: "Kofi Asante",
    verified: true,
    headline: "Energy policy advisor",
    location: "Cape Town, South Africa",
    country: "ZA",
    sector: "energy-climate",
    chapter: "cape-town",
    skills: ["Solar", "Policy"],
    mutual: 3,
    tone: "info",
    connection: "pending",
    openToMentoring: true,
    diaspora: true,
  },
  {
    handle: "zanele-dlamini",
    name: "Zanele Dlamini",
    verified: true,
    headline: "Climate finance analyst",
    location: "Durban, South Africa",
    country: "ZA",
    sector: "energy-climate",
    chapter: "",
    skills: ["Solar", "Grid finance"],
    mutual: 21,
    tone: "accent",
    connection: "none",
    following: true,
    openToMentoring: true,
    openToCollaborate: true,
  },
  {
    handle: "mandla-ovens",
    name: "Mandla Ovens",
    verified: true,
    headline: "Battery storage engineer",
    location: "Johannesburg, South Africa",
    country: "ZA",
    sector: "energy-climate",
    chapter: "johannesburg",
    skills: ["Solar"],
    mutual: 5,
    tone: "tint",
    connection: "connected",
    following: true,
    openToMentoring: true,
  },
  {
    handle: "rhoda-banda",
    name: "Rhoda Banda",
    verified: true,
    headline: "Grid integration lead · Mentor",
    location: "Johannesburg, South Africa",
    country: "ZA",
    sector: "energy-climate",
    chapter: "johannesburg",
    skills: ["Solar", "Grid finance", "Policy"],
    mutual: 2,
    tone: "warning",
    connection: "none",
    openToMentoring: true,
    diaspora: true,
  },
  {
    handle: "wanjiru-kamau",
    name: "Wanjiru Kamau",
    headline: "Climate Policy Analyst",
    location: "Nairobi, Kenya",
    country: "KE",
    sector: "energy-climate",
    chapter: "nairobi",
    skills: ["Policy"],
    mutual: 9,
    tone: "info",
    connection: "connected",
    following: true,
    openToCollaborate: true,
  },
  {
    handle: "amara-okafor",
    name: "Amara Okafor",
    verified: true,
    headline: "Founder, Lagos AgriHub",
    location: "Lagos, Nigeria",
    country: "NG",
    sector: "agriculture",
    chapter: "lagos",
    skills: ["Agritech", "Trade"],
    mutual: 14,
    tone: "accent",
    connection: "connected",
    following: true,
    openToMentoring: true,
  },
  {
    handle: "kwame-mensah",
    name: "Kwame Mensah",
    verified: true,
    headline: "Product Lead, PayBridge",
    location: "Accra, Ghana",
    country: "GH",
    sector: "fintech",
    chapter: "accra",
    skills: ["Payments", "Product"],
    mutual: 6,
    tone: "success",
    connection: "none",
    openToCollaborate: true,
  },
  {
    handle: "yohannes-tesfaye",
    name: "Yohannes Tesfaye",
    headline: "Health-tech founder",
    location: "London, United Kingdom",
    country: "GB",
    sector: "design",
    chapter: "london",
    skills: ["Product"],
    mutual: 1,
    tone: "tint",
    connection: "none",
    diaspora: true,
    openToMentoring: true,
  },
];

export const connectionRequests: { handle: string; name: string; headline: string; tone: "info" | "success" | "accent" }[] = [
  { handle: "leila-benali", name: "Leila Benali", headline: "Trade Economist · Casablanca", tone: "info" },
  { handle: "chinedu-eze", name: "Chinedu Eze", headline: "Product Designer · London", tone: "success" },
  { handle: "fatou-diallo", name: "Fatou Diallo", headline: "Fintech investor · Dakar", tone: "accent" },
];
