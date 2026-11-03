import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import type { DirectoryMember, HashtagSuggestion, Page } from "@chartermission/contracts";
import { Icon, Panel, buttonClasses } from "@chartermission/ui";
import { LeftRail } from "@/components/left-rail";
import { MemberRow } from "@/components/network/member-row";
import { PageColumns } from "@/components/page-columns";
import { RightRail } from "@/components/right-rail";
import { requireClientViewer } from "@/components/social/data";
import { topicHref } from "@/components/social/links";
import { EmptyState, LoadingStatus, PanelSkeleton } from "@/components/social/skeletons";
import { apiGet } from "@/lib/api/server";

export const metadata: Metadata = { title: "Search" };

async function SearchResults({ searchParams }: { searchParams: PageProps<"/search">["searchParams"] }) {
  const sp = await searchParams;
  const q = (Array.isArray(sp.q) ? sp.q[0] : sp.q)?.trim().slice(0, 100) ?? "";
  await requireClientViewer(`/search?q=${encodeURIComponent(q)}`);

  if (!q) {
    return (
      <EmptyState icon="search" title="Search Charter Mission">
        Find members by name, role or skill, and topics by hashtag.
      </EmptyState>
    );
  }

  const term = q.replace(/^[#@]/, "");
  const tagTerm = term.replace(/[^A-Za-z0-9_]/g, "");
  const [members, tags] = await Promise.all([
    q.startsWith("#") ? null : apiGet<Page<DirectoryMember>>("/members", { q: term, limit: 10 }).catch(() => null),
    q.startsWith("@") || !tagTerm ? [] : apiGet<HashtagSuggestion[]>("/hashtags/suggest", { q: tagTerm }).catch(() => []),
  ]);
  const memberItems = members?.items ?? [];

  return (
    <>
      <p className="text-sm text-secondary" role="status">
        Results for <strong className="font-semibold text-ink">“{q}”</strong>
      </p>

      {tags.length > 0 && (
        <Panel aria-labelledby="search-topics" className="flex flex-col">
          <h2 id="search-topics" className="px-5 pb-2 pt-4 text-h3 text-ink">
            Topics
          </h2>
          <ul className="flex flex-col divide-y divide-line">
            {tags.map((tag) => (
              <li key={tag.tag}>
                <Link href={topicHref(tag.tag)} className="flex items-center gap-3 px-5 py-3 hover:bg-primary-tint-2">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-accent-light text-accent">
                    <Icon name="hash" size={20} />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-sm font-medium text-ink">#{tag.tag}</span>
                    <span className="text-xs text-secondary">
                      {tag.posts.toLocaleString("en-US")} post{tag.posts === 1 ? "" : "s"}
                    </span>
                  </span>
                  {tag.trending && (
                    <span className="flex items-center gap-1 text-xs text-accent-hover">
                      <Icon name="trending" size={14} className="text-accent" />
                      Trending
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {memberItems.length > 0 && (
        <Panel aria-labelledby="search-members" className="flex flex-col">
          <div className="flex items-center justify-between px-5 pb-2 pt-4">
            <h2 id="search-members" className="text-h3 text-ink">
              Members
            </h2>
            {members?.nextCursor && (
              <Link href={`/network?tab=directory&q=${encodeURIComponent(term)}`} className="text-sm font-medium text-primary-light hover:underline">
                See all in the directory
              </Link>
            )}
          </div>
          <ul className="flex flex-col divide-y divide-line">
            {memberItems.map((member) => (
              <MemberRow key={member.id} member={member} />
            ))}
          </ul>
        </Panel>
      )}

      {tags.length === 0 && memberItems.length === 0 && (
        <EmptyState
          icon="search"
          title={`No results for “${q}”`}
          actions={
            <Link href="/network?tab=directory" className={buttonClasses({ variant: "secondary", size: "small" })}>
              Browse the directory
            </Link>
          }
        >
          Check the spelling, try a shorter term, or search a hashtag with # (for example #AfCFTA).
        </EmptyState>
      )}

      <p className="flex items-start gap-2 rounded-lg bg-surface px-4 py-3 text-xs text-secondary">
        <Icon name="clock" size={14} className="mt-px shrink-0" />
        Search covers members and topics for now. Opportunities, events, initiatives, courses, chapters and organisations join search as those
        sections launch.
      </p>
    </>
  );
}

/** Global search (spec 4.14) — Phase 1 covers members and hashtags. */
export default function SearchPage({ searchParams }: PageProps<"/search">) {
  return (
    <PageColumns left={<LeftRail />} right={<RightRail />}>
      <h1 className="text-h2 text-ink">Search</h1>
      <form action="/search" role="search" className="flex gap-2">
        <label className="flex h-11 min-w-0 flex-1 items-center gap-2.5 rounded-[10px] border border-line bg-card px-3.5 text-disabled focus-within:border-primary-light focus-within:ring-2 focus-within:ring-primary-light/20">
          <Icon name="search" size={18} className="shrink-0" />
          <span className="sr-only">Search members and topics</span>
          <SearchInput searchParams={searchParams} />
        </label>
        <button type="submit" className={buttonClasses()}>
          Search
        </button>
      </form>
      <Suspense
        fallback={
          <>
            <LoadingStatus label="Searching" />
            <PanelSkeleton className="h-[220px]" lines={4} />
          </>
        }
      >
        <SearchResults searchParams={searchParams} />
      </Suspense>
    </PageColumns>
  );
}

function SearchInput({ searchParams }: { searchParams: PageProps<"/search">["searchParams"] }) {
  return (
    <Suspense fallback={<input name="q" type="search" placeholder="Name, skill or #topic" className="h-full w-full min-w-0 bg-transparent text-sm text-ink outline-none placeholder:text-disabled" />}>
      <SearchInputValue searchParams={searchParams} />
    </Suspense>
  );
}

async function SearchInputValue({ searchParams }: { searchParams: PageProps<"/search">["searchParams"] }) {
  const sp = await searchParams;
  const q = Array.isArray(sp.q) ? sp.q[0] : sp.q;
  return (
    <input
      name="q"
      type="search"
      defaultValue={q ?? ""}
      placeholder="Name, skill or #topic"
      className="h-full w-full min-w-0 bg-transparent text-sm text-ink outline-none placeholder:text-disabled"
    />
  );
}
