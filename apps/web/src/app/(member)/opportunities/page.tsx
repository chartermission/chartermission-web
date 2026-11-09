import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { OpportunitiesQuery, type OpportunitySummary, type Page } from "@chartermission/contracts";
import { Icon, Panel, buttonClasses } from "@chartermission/ui";
import { PageHeader, PageShell } from "@/components/discover/page-shell";
import { deadlineChip } from "@/components/opportunities/opportunity-card";
import { OpportunityFilterPanel, OpportunityFilters, OpportunitySortSelect, filtersHref } from "@/components/opportunities/opportunity-filters";
import { OpportunityList } from "@/components/opportunities/opportunity-list";
import { requireClientViewer, settle } from "@/components/social/data";
import { errorMessage } from "@/components/social/error-message";
import { Bone, EmptyState, LoadingStatus, PanelSkeleton, SectionError } from "@/components/social/skeletons";
import { apiGet } from "@/lib/api/server";
import { getTaxonomies } from "@/lib/taxonomies";

export const metadata: Metadata = {
  title: "Opportunities",
  description: "Jobs, fellowships, grants and calls for partners posted by Charter Mission members.",
};

type SearchParams = PageProps<"/opportunities">["searchParams"];

function parseQuery(params: Awaited<SearchParams>): OpportunitiesQuery {
  const flat = Object.fromEntries(Object.entries(params).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
  const parsed = OpportunitiesQuery.safeParse(flat);
  return parsed.success ? { ...parsed.data, cursor: undefined } : OpportunitiesQuery.parse({});
}

function apiQuery(q: OpportunitiesQuery) {
  return { q: q.q, type: q.type, country: q.country, remote: q.remote ? "true" : undefined, sector: q.sector, deadline: q.deadline, sort: q.sort, limit: q.limit };
}

async function SavedRail() {
  const saved = await apiGet<Page<OpportunitySummary>>("/me/opportunities", { tab: "saved", limit: 5 }).catch(() => null);
  return (
    <Panel className="flex flex-col gap-3 p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-h3 text-ink">Saved</h2>
        <Link href="/opportunities/mine?tab=saved" className="text-xs text-primary-light hover:underline">
          See all
        </Link>
      </div>
      {saved?.items.length ? (
        <ul className="flex flex-col gap-3">
          {saved.items.map((item) => (
            <li key={item.id}>
              <Link href={`/opportunities/${item.slug}`} className="group flex min-w-0 flex-col">
                <span className="text-sm font-medium text-ink group-hover:underline">{item.title}</span>
                <span className="text-xs text-secondary">{deadlineChip(item).label}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-secondary">Tap the bookmark on a listing to keep it here.</p>
      )}
    </Panel>
  );
}

function Rail() {
  return (
    <aside aria-label="Your opportunities" className="flex w-72 shrink-0 flex-col gap-4 max-xl:hidden">
      <section className="flex flex-col gap-3 rounded-card bg-primary p-5">
        <h2 className="flex items-center gap-2 text-h3 text-inverse">
          <Icon name="briefcase" size={20} />
          Hiring or funding?
        </h2>
        <p className="text-sm text-primary-tint">Post a role, fellowship or grant. Members apply with their profile and a note, and you review them here.</p>
        <Link href="/opportunities/new" className={buttonClasses({ variant: "accent", size: "small", className: "self-start" })}>
          Post an opportunity
        </Link>
      </section>
      <Suspense fallback={<PanelSkeleton className="h-[180px]" lines={3} />}>
        <SavedRail />
      </Suspense>
      <Panel className="flex flex-col gap-2.5 p-5">
        <h2 className="flex items-center gap-2 text-sm font-medium text-ink">
          <Icon name="shield" size={18} className="text-success" />
          Keep it safe
        </h2>
        <p className="text-xs text-secondary">
          Listings go live straight away. Never pay to apply, and report anything that looks wrong from the listing’s page: moderators review every report.
        </p>
      </Panel>
    </aside>
  );
}

async function Results({ searchParams }: { searchParams: SearchParams }) {
  await requireClientViewer("/opportunities");
  const query = parseQuery(await searchParams);
  const [page, taxonomies] = await Promise.all([settle(apiGet<Page<OpportunitySummary>>("/opportunities", apiQuery(query))), getTaxonomies().catch(() => null)]);
  const collator = new Intl.Collator("en");
  const countries = (taxonomies?.countries ?? []).map((c) => ({ value: c.code, label: c.name })).sort((a, b) => collator.compare(a.label, b.label));
  const sectors = (taxonomies?.sectors ?? []).map((s) => ({ value: s.slug, label: s.name })).sort((a, b) => collator.compare(a.label, b.label));
  const filtered = !!(query.q || query.type || query.country || query.remote || query.sector || query.deadline !== "any");
  return (
    <>
      <OpportunityFilters query={query} countries={countries} sectors={sectors} />
      <div className="flex items-start gap-6">
        <OpportunityFilterPanel query={query} countries={countries} sectors={sectors} />
        <section aria-labelledby="results-heading" className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <h2 id="results-heading" className="text-md font-medium text-ink">
              {filtered ? "Matching opportunities" : "Open opportunities"}
            </h2>
            <OpportunitySortSelect query={query} />
          </div>
          {page.ok ? (
            <OpportunityList
              key={JSON.stringify(query)}
              path="/opportunities"
              query={apiQuery(query)}
              initial={page.data}
              empty={
                filtered ? (
                  <EmptyState
                    icon="filter"
                    title="No opportunities match these filters"
                    actions={
                      <Link href={filtersHref("/opportunities", {})} className={buttonClasses({ variant: "secondary", size: "small" })}>
                        Clear filters
                      </Link>
                    }
                  >
                    Try removing a filter or searching for something broader.
                  </EmptyState>
                ) : (
                  <EmptyState
                    icon="briefcase"
                    title="No open opportunities yet"
                    actions={
                      <Link href="/opportunities/new" className={buttonClasses({ size: "small" })}>
                        Post the first one
                      </Link>
                    }
                  >
                    Jobs, fellowships and grants from members appear here.
                  </EmptyState>
                )
              }
            />
          ) : (
            <SectionError message={errorMessage(page.error)} retryHref="/opportunities" />
          )}
        </section>
        <Rail />
      </div>
    </>
  );
}

function ResultsSkeleton() {
  return (
    <>
      <LoadingStatus label="Loading opportunities" />
      <Bone className="h-11 w-full" />
      <div className="flex items-start gap-6">
        <PanelSkeleton className="h-[480px] w-[260px] max-lg:hidden" lines={8} />
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <PanelSkeleton key={i} className="h-[140px]" lines={3} />
          ))}
        </div>
      </div>
    </>
  );
}

/** Opportunities — Figma "Web / Opportunities" (node 10:907), on GET /opportunities. */
export default function OpportunitiesPage({ searchParams }: PageProps<"/opportunities">) {
  return (
    <PageShell>
      <PageHeader
        title="Opportunities"
        description="Jobs, fellowships, grants and calls for partners from the community. Apply with your profile in a couple of clicks."
        actions={
          <>
            <Link href="/opportunities/mine" className={buttonClasses({ variant: "secondary" })}>
              My opportunities
            </Link>
            <Link href="/opportunities/new" className={buttonClasses({ variant: "accent" })}>
              Post an opportunity
            </Link>
          </>
        }
      />
      <Suspense fallback={<ResultsSkeleton />}>
        <Results searchParams={searchParams} />
      </Suspense>
    </PageShell>
  );
}
