/*
 * Opportunities directory placeholder content (Figma "Web / Opportunities",
 * node 10:907). Shapes mirror what the API will return; deadlines are ISO
 * dates so the client can filter by "closing this week / month".
 */

/** Reference "today" for the mock data (deadline filters are relative to it). */
export const opportunitiesToday = "2026-11-02";

export const opportunityTypes = [
  { value: "jobs", label: "Jobs" },
  { value: "fellowships", label: "Fellowships" },
  { value: "grants", label: "Grants & funding" },
  { value: "volunteering", label: "Volunteering" },
  { value: "partners", label: "Calls for partners" },
] as const;

export type OpportunityTypeFilter = (typeof opportunityTypes)[number]["value"];

export const opportunityCountries = [
  { value: "", label: "Any country" },
  { value: "GH", label: "Ghana" },
  { value: "KE", label: "Kenya" },
  { value: "NG", label: "Nigeria" },
  { value: "ZA", label: "South Africa" },
  { value: "multi", label: "Multiple countries" },
] as const;

export const opportunitySectors = [
  { value: "", label: "All sectors" },
  { value: "agriculture", label: "Agriculture" },
  { value: "climate", label: "Climate" },
  { value: "fintech", label: "Fintech" },
  { value: "leadership", label: "Leadership" },
  { value: "social-impact", label: "Social impact" },
] as const;

export const opportunityDeadlines = [
  { value: "week", label: "Closing this week" },
  { value: "month", label: "Closing this month" },
  { value: "any", label: "Any time" },
] as const;

export type OpportunityDeadlineFilter = (typeof opportunityDeadlines)[number]["value"];

export const opportunitySorts = [
  { value: "closing", label: "Closing soon" },
  { value: "newest", label: "Newest" },
  { value: "title", label: "Title A–Z" },
] as const;

export type OpportunitySort = (typeof opportunitySorts)[number]["value"];

export type Opportunity = {
  slug: string;
  title: string;
  organisation: string;
  /** Place shown in the meta line, e.g. "Nairobi, Kenya". */
  place: string;
  country: string;
  workMode: "Remote" | "Remote-friendly" | "Hybrid" | "On-site" | "In person";
  type: OpportunityTypeFilter;
  /** Chip label for the engagement, e.g. "Full-time". */
  engagement: string;
  sector: string;
  sectorLabel: string;
  /** ISO date (YYYY-MM-DD). */
  deadline: string;
  /** ISO date the listing was published. */
  published: string;
};

export const opportunities: Opportunity[] = [
  {
    slug: "programme-manager-youth-employment",
    title: "Programme Manager, Youth Employment",
    organisation: "Ubuntu Futures Foundation",
    place: "Nairobi, Kenya",
    country: "KE",
    workMode: "Hybrid",
    type: "jobs",
    engagement: "Full-time",
    sector: "social-impact",
    sectorLabel: "Social impact",
    deadline: "2026-11-14",
    published: "2026-10-20",
  },
  {
    slug: "charter-mission-fellows-2027",
    title: "Charter Mission Fellows 2027",
    organisation: "Charter Mission",
    place: "15 countries",
    country: "multi",
    workMode: "Remote-friendly",
    type: "fellowships",
    engagement: "Fellowship",
    sector: "leadership",
    sectorLabel: "Leadership",
    deadline: "2026-11-30",
    published: "2026-11-01",
  },
  {
    slug: "senior-backend-engineer-payments",
    title: "Senior Backend Engineer (Payments)",
    organisation: "PayBridge",
    place: "Accra, Ghana",
    country: "GH",
    workMode: "Remote",
    type: "jobs",
    engagement: "Full-time",
    sector: "fintech",
    sectorLabel: "Fintech",
    deadline: "2026-12-06",
    published: "2026-10-28",
  },
  {
    slug: "climate-data-analyst",
    title: "Climate Data Analyst",
    organisation: "GreenGrid Africa",
    place: "Johannesburg, South Africa",
    country: "ZA",
    workMode: "On-site",
    type: "jobs",
    engagement: "Contract",
    sector: "climate",
    sectorLabel: "Climate",
    deadline: "2026-12-10",
    published: "2026-10-25",
  },
  {
    slug: "mentors-clean-cooking-hackathon",
    title: "Mentors: Clean Cooking Hackathon",
    organisation: "Nairobi chapter",
    place: "Nairobi, Kenya",
    country: "KE",
    workMode: "In person",
    type: "volunteering",
    engagement: "Volunteer",
    sector: "climate",
    sectorLabel: "Climate",
    deadline: "2026-11-21",
    published: "2026-10-30",
  },
  {
    slug: "agri-cooperative-partners-call",
    title: "Partners for Smallholder Cold-Chain Pilot",
    organisation: "Lagos AgriHub",
    place: "Lagos, Nigeria",
    country: "NG",
    workMode: "In person",
    type: "partners",
    engagement: "Partnership",
    sector: "agriculture",
    sectorLabel: "Agriculture",
    deadline: "2026-12-18",
    published: "2026-10-31",
  },
  {
    slug: "youth-climate-innovation-grant",
    title: "Youth Climate Innovation Grant",
    organisation: "Sahel Green Fund",
    place: "Accra, Ghana",
    country: "GH",
    workMode: "Remote-friendly",
    type: "grants",
    engagement: "Grant",
    sector: "climate",
    sectorLabel: "Climate",
    deadline: "2027-01-15",
    published: "2026-10-22",
  },
];

export const savedOpportunities = [
  { slug: "export-readiness-grant", title: "Export Readiness Grant", closes: "Closes 5 Dec" },
  { slug: "trade-policy-fellow", title: "Trade Policy Fellow", closes: "Closes 20 Nov" },
];
