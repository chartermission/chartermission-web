import Link from "next/link";
import { Suspense } from "react";
import type { SuggestedMember, TrendingResponse } from "@chartermission/contracts";
import { Panel } from "@chartermission/ui";
import { apiGet, getViewer } from "@/lib/api/server";
import { getTaxonomies } from "@/lib/taxonomies";
import { upcomingEvents } from "@/lib/mock-data";
import { SuggestionList } from "./network/suggestion-list";
import { PanelSkeleton } from "./social/skeletons";
import { TrendingTopics } from "./trending-topics";

async function Trending() {
  const [viewer, initial, taxonomies] = await Promise.all([
    getViewer(),
    apiGet<TrendingResponse>("/trending", { scope: "global", window: "24h", limit: 5 }).catch(() => null),
    getTaxonomies().catch(() => null),
  ]);
  const code = viewer?.countryCode ?? null;
  const name = code ? (taxonomies?.countries.find((c) => c.code === code)?.name ?? code) : null;
  return <TrendingTopics initial={initial} country={code && name ? { code, name } : null} />;
}

/** "People you may know" — GET /members/suggestions, each labelled with its reason (CM-DSH-03). */
async function PeopleYouMayKnow() {
  const suggestions = await apiGet<SuggestedMember[]>("/members/suggestions").catch(() => null);
  if (!suggestions) return null;
  return (
    <Panel aria-labelledby="pymk-heading" className="flex flex-col gap-3.5 p-5">
      <div className="flex items-center justify-between">
        <h2 id="pymk-heading" className="text-h3 text-ink">
          People you may know
        </h2>
        <Link href="/network?tab=suggestions" className="text-xs text-primary-light hover:underline">
          See all
        </Link>
      </div>
      {suggestions.length ? (
        <SuggestionList members={suggestions.slice(0, 4)} />
      ) : (
        <p className="text-sm text-secondary">
          No suggestions yet. Add your sectors and skills in{" "}
          <Link href="/settings/profile" className="font-medium text-primary-light hover:underline">
            your profile
          </Link>{" "}
          or{" "}
          <Link href="/network?tab=directory" className="font-medium text-primary-light hover:underline">
            browse the directory
          </Link>
          .
        </p>
      )}
    </Panel>
  );
}

export function DateBadge({ month, day }: { month: string; day: string }) {
  return (
    <span className="flex shrink-0 flex-col items-center rounded-lg bg-accent-light px-2.5 py-1.5 font-semibold">
      <span className="text-label text-accent-hover">{month}</span>
      <span className="text-h3 text-ink">{day}</span>
    </span>
  );
}

/** Events arrive in a later phase; this widget stays on placeholder data until then. */
export function UpcomingEvents() {
  return (
    <Panel className="flex flex-col gap-3 p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-h3 text-ink">Upcoming events</h2>
        <Link href="/events" className="text-xs text-primary-light hover:underline">
          See all
        </Link>
      </div>
      {upcomingEvents.map((event) => (
        <Link key={event.slug} href={`/events/${event.slug}`} className="group flex items-center gap-3">
          <DateBadge month={event.month} day={event.day} />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-sm font-medium text-ink group-hover:underline">{event.title}</span>
            <span className="text-xs text-secondary">{event.meta}</span>
          </span>
        </Link>
      ))}
    </Panel>
  );
}

export function SiteFooter() {
  return (
    <footer className="text-xs text-disabled">
      <nav aria-label="Footer" className="flex flex-wrap gap-x-1">
        <Link href="/about" className="hover:underline">About</Link>·
        <Link href="/guidelines" className="hover:underline">Guidelines</Link>·
        <Link href="/privacy" className="hover:underline">Privacy</Link>·
        <Link href="/terms" className="hover:underline">Terms</Link>·
        <Link href="/help" className="hover:underline">Help</Link>
      </nav>
      <p>© 2026 Charter Mission · Powered by Charter Center learning</p>
    </footer>
  );
}

/** Right column: trending topics, people you may know, upcoming events, footer. */
export function RightRail() {
  return (
    <aside aria-label="Trending and suggestions" className="flex w-80 shrink-0 flex-col gap-4">
      <Suspense fallback={<PanelSkeleton className="h-[420px]" lines={5} />}>
        <Trending />
      </Suspense>
      <Suspense fallback={<PanelSkeleton className="h-[220px]" lines={3} />}>
        <PeopleYouMayKnow />
      </Suspense>
      <UpcomingEvents />
      <SiteFooter />
    </aside>
  );
}
