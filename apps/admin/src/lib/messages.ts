import type { AnnouncementAudience, AnnouncementChannels, AnnouncementInput, AnnouncementStatus } from "@chartermission/contracts";

type Translate = (key: string, vars?: Record<string, string | number | null | undefined>) => string;

/** Names for the audience filters' ids, loaded with the page (GET /taxonomies, GET /admin/exams). */
export type AudienceOptions = {
  countries: { code: string; name: string }[];
  chapters: { id: string; slug: string; name: string; countryCode: string }[];
  sectors: { id: string; name: string }[];
  /** Null when the exams list couldn't be loaded: the filter is hidden. */
  exams: { id: string; title: string }[] | null;
};

export const LANGUAGE_NAMES: Record<"en" | "fr" | "ar", string> = { en: "English", fr: "Français", ar: "العربية" };

/** Drops filters that don't narrow anything, so an empty filter is `{}` (every active member). */
export function cleanAudience(a: AnnouncementAudience): AnnouncementAudience {
  const out: AnnouncementAudience = {};
  if (a.countries?.length) out.countries = a.countries;
  if (a.chapterIds?.length) out.chapterIds = a.chapterIds;
  if (a.sectorIds?.length) out.sectorIds = a.sectorIds;
  if (a.verified && a.verified !== "any") out.verified = a.verified;
  if (a.joinedFrom) out.joinedFrom = a.joinedFrom;
  if (a.joinedTo) out.joinedTo = a.joinedTo;
  if (a.passedExamIds?.length) out.passedExamIds = a.passedExamIds;
  if (a.locales?.length) out.locales = a.locales;
  if (a.ambassadorsOnly) out.ambassadorsOnly = true;
  return out;
}

/** "Email, inbox message and notification": one full sentence per combination, so each translates whole. */
export function channelsText(c: AnnouncementChannels | AnnouncementInput["channels"], t: Translate): string {
  const key = `${c.email ? "e" : ""}${c.message ? "m" : ""}${c.notification ? "n" : ""}`;
  const text: Record<string, string> = {
    e: "Email",
    m: "Inbox message",
    n: "Notification",
    em: "Email and inbox message",
    en: "Email and notification",
    mn: "Inbox message and notification",
    emn: "Email, inbox message and notification",
  };
  return key ? t(text[key]) : t("No channel chosen");
}

export const STATUS_LABEL: Record<AnnouncementStatus, string> = {
  draft: "Draft",
  sending: "Sending",
  sent: "Sent",
  failed: "Failed",
  cancelled: "Cancelled",
};

export const STATUS_TONE: Record<AnnouncementStatus, "neutral" | "info" | "success" | "error" | "warning"> = {
  draft: "neutral",
  sending: "info",
  sent: "success",
  failed: "error",
  cancelled: "warning",
};

/** A YYYY-MM-DD day as a date in the admin's language, never moved by their time zone. */
export function formatDay(day: string, tag: string): string {
  return new Intl.DateTimeFormat(tag, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`));
}

/**
 * The audience as readable lines ("Countries: Nigeria, Kenya"). Empty filter: one line saying it
 * goes to every active member. Ids no longer in the lists show as "1 other".
 */
export function audienceLines(a: AnnouncementAudience, options: AudienceOptions, t: Translate, tag: string, countryName: (code: string) => string): { label: string; value: string }[] {
  const lines: { label: string; value: string }[] = [];
  const names = (ids: string[] | undefined, list: { id: string; name: string }[]) => {
    if (!ids?.length) return null;
    const known = ids.map((id) => list.find((x) => x.id === id)?.name).filter((n): n is string => !!n);
    const unknown = ids.length - known.length;
    return [...known, ...(unknown > 0 ? [t("{count} other", { count: unknown })] : [])].join(", ");
  };
  if (a.countries?.length) lines.push({ label: t("Countries"), value: a.countries.map(countryName).join(", ") });
  const chapters = names(a.chapterIds, options.chapters);
  if (chapters) lines.push({ label: t("Chapters"), value: chapters });
  const sectors = names(a.sectorIds, options.sectors);
  if (sectors) lines.push({ label: t("Sectors"), value: sectors });
  if (a.verified === "verified") lines.push({ label: t("Verified"), value: t("Verified members only") });
  if (a.verified === "unverified") lines.push({ label: t("Verified"), value: t("Members without the verified tick") });
  if (a.joinedFrom || a.joinedTo) {
    const value =
      a.joinedFrom && a.joinedTo
        ? t("{from} to {to}", { from: formatDay(a.joinedFrom, tag), to: formatDay(a.joinedTo, tag) })
        : a.joinedFrom
          ? t("On or after {date}", { date: formatDay(a.joinedFrom, tag) })
          : t("On or before {date}", { date: formatDay(a.joinedTo!, tag) });
    lines.push({ label: t("Joined"), value });
  }
  const exams = names(a.passedExamIds, (options.exams ?? []).map((e) => ({ id: e.id, name: e.title })));
  if (exams) lines.push({ label: t("Passed exams"), value: exams });
  if (a.locales?.length) lines.push({ label: t("Language"), value: a.locales.map((l) => LANGUAGE_NAMES[l]).join(", ") });
  if (a.ambassadorsOnly) lines.push({ label: t("Ambassadors"), value: t("Ambassadors only") });
  return lines;
}

export type TextPart = { kind: "text"; text: string } | { kind: "link"; href: string; text: string };

const URL_RE = /https?:\/\/[^\s<>"]+/gi;

/** Splits plain text into text and links (trailing punctuation stays outside the link). */
export function linkify(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_RE)) {
    let url = match[0];
    const trailing = /[.,;:!?)\]'’”]+$/.exec(url)?.[0] ?? "";
    if (trailing) url = url.slice(0, -trailing.length);
    const start = match.index ?? 0;
    if (start > last) parts.push({ kind: "text", text: text.slice(last, start) });
    parts.push({ kind: "link", href: url, text: url });
    last = start + url.length;
  }
  if (last < text.length) parts.push({ kind: "text", text: text.slice(last) });
  return parts;
}

/** Blank lines start a new paragraph. */
export function paragraphs(text: string): string[] {
  return text
    .trim()
    .split(/\n[ \t]*\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
}
