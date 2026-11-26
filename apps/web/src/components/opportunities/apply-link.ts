import type { OpportunityType } from "@chartermission/contracts";
import type { IconName } from "@chartermission/ui";
import type { Translate } from "@/i18n/translate";

/** The site's name for "Apply on {host}" (www. left off), or null for an email address or a bad link. */
export function applyHost(applyUrl: string): string | null {
  if (applyUrl.toLowerCase().startsWith("mailto:")) return null;
  try {
    return new URL(applyUrl).hostname.replace(/^www\./i, "") || null;
  } catch {
    return null;
  }
}

/** "Apply on acme.org" for a link, "Apply by email" for an email address. */
export function applyLinkLabel(t: Translate, applyUrl: string): string {
  const host = applyHost(applyUrl);
  return host ? t("Apply on {host}", { host }) : t("Apply by email");
}

/** The address shown in the form for an email (mailto: left off) or a link. */
export function applyUrlForInput(applyUrl: string | null | undefined): string {
  return (applyUrl ?? "").replace(/^mailto:/i, "");
}

/** An icon for each kind of opportunity (shared cards and lists). */
export const OPPORTUNITY_TYPE_ICONS: Record<OpportunityType, IconName> = {
  employment: "briefcase",
  internship: "briefcase",
  fellowship: "users",
  scholarship: "book",
  grant: "target",
  training: "book",
  mentorship: "user-plus",
  volunteering: "users",
  competition: "flame",
  call_for_proposals: "megaphone",
};
