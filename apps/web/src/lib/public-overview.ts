import "server-only";
import { cacheLife } from "next/cache";
import type { PublicOverview } from "@chartermission/contracts";
import { API_INTERNAL_URL } from "@/lib/api/server";

const EMPTY: PublicOverview = { members: 0, countries: 0, chapters: 0, courses: 0, upcomingEvents: 0, pages: 0, topChapters: [], trending: [], events: [] };

/**
 * GET /public/overview: live numbers for the landing page (members, chapters, topics, next events).
 * It reads no cookies, so it is cached on the server for a few minutes and is part of the static
 * shell. If the API can't be reached (including during `next build`), the page falls back to its
 * copy without numbers rather than failing.
 */
export async function getPublicOverview(): Promise<PublicOverview> {
  "use cache";
  const res = await fetch(`${API_INTERNAL_URL}/public/overview`, { headers: { accept: "application/json" } }).catch(() => null);
  if (!res?.ok) {
    cacheLife("seconds");
    return EMPTY;
  }
  cacheLife("minutes");
  return (await res.json()) as PublicOverview;
}
