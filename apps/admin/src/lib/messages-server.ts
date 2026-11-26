import "server-only";
import type { AdminExamSummary, MessagingSettingsView, Taxonomies } from "@chartermission/contracts";
import { apiGet } from "@/lib/api/server";
import type { AudienceOptions } from "@/lib/messages";

/**
 * Countries, chapters and sectors (GET /taxonomies) and exams members can have passed (GET /admin/exams),
 * for the audience filters and the audience summary. Throws when the taxonomies can't be loaded;
 * the exams filter is left out when the exams list can't be.
 */
export async function loadAudienceOptions(): Promise<AudienceOptions> {
  const [tax, exams] = await Promise.all([
    apiGet<Taxonomies>("/taxonomies"),
    apiGet<AdminExamSummary[]>("/admin/exams").catch(() => null),
  ]);
  return {
    countries: tax.countries.map((c) => ({ code: c.code, name: c.name })).sort((a, b) => a.name.localeCompare(b.name)),
    chapters: tax.chapters.map((c) => ({ id: c.id, slug: c.slug, name: c.name, countryCode: c.countryCode })).sort((a, b) => a.name.localeCompare(b.name)),
    sectors: tax.sectors.map((s) => ({ id: s.id, name: s.name })).sort((a, b) => a.name.localeCompare(b.name)),
    exams: exams ? exams.filter((e) => e.status !== "draft").map((e) => ({ id: e.id, title: e.title })) : null,
  };
}

/** The sender account and the official accounts to choose from; null when it can't be loaded. */
export async function loadMessagingSettings(): Promise<MessagingSettingsView | null> {
  return apiGet<MessagingSettingsView>("/admin/settings/messaging").catch(() => null);
}
