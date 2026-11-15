import type { PageRef, PageTeamSize } from "@chartermission/contracts";

/** The compact page shape, picked from a fuller page object (so client props stay small). */
export function toPageRef(page: PageRef): PageRef {
  return { id: page.id, slug: page.slug, name: page.name, tagline: page.tagline, logoUrl: page.logoUrl, verified: page.verified, official: page.official };
}

/** How many people work there, as shown on the page and in the form. Print through t() / <T>. */
export const TEAM_SIZE_LABELS: Record<PageTeamSize, string> = {
  "1": "Just one person",
  "2-10": "2–10 people",
  "11-50": "11–50 people",
  "51-200": "51–200 people",
  "201-1000": "201–1,000 people",
  "1000+": "More than 1,000 people",
};

/** Social networks a page can link to, in display order. Plain names: no brand logos. */
export const SOCIAL_NETWORKS = [
  { key: "linkedin", label: "LinkedIn" },
  { key: "x", label: "X" },
  { key: "facebook", label: "Facebook" },
  { key: "instagram", label: "Instagram" },
  { key: "youtube", label: "YouTube" },
] as const;

export type SocialNetwork = (typeof SOCIAL_NETWORKS)[number]["key"];

/** "tel:" link for a number typed as "+233 30 123 4567". */
export const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, "")}`;

/** WhatsApp click-to-chat link: digits only, no plus. */
export const whatsappHref = (phone: string) => `https://wa.me/${phone.replace(/\D/g, "")}`;

/** "example.org" from "https://www.example.org/". */
export const displayUrl = (url: string) => url.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/$/, "");

/** People type "example.org": accept it and store a full address. */
export const withScheme = (value: string) => {
  const v = value.trim();
  return v ? (/^https?:\/\//i.test(v) ? v : `https://${v}`) : null;
};
