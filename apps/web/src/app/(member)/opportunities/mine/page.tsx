import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import type { OpportunitySummary, Page } from "@chartermission/contracts";
import { buttonClasses, cn } from "@chartermission/ui";
import { PageHeader, PageShell } from "@/components/discover/page-shell";
import { OpportunityList } from "@/components/opportunities/opportunity-list";
import { requireClientViewer, settle } from "@/components/social/data";
import { errorMessage } from "@/components/social/error-message";
import { EmptyState, PanelSkeleton, SectionError } from "@/components/social/skeletons";
import { apiGet } from "@/lib/api/server";

export const metadata: Metadata = { title: "My opportunities" };

type Tab = "posted" | "applied" | "saved";
const TABS: { value: Tab; label: string }[] = [
  { value: "posted", label: "Posted" },
  { value: "applied", label: "Applied" },
  { value: "saved", label: "Saved" },
];

const empties: Record<Tab, { title: string; text: string; action: { href: string; label: string } }> = {
  posted: { title: "You haven’t posted anything yet", text: "Post a job, fellowship or grant and review applicants here.", action: { href: "/opportunities/new", label: "Post an opportunity" } },
  applied: { title: "No applications yet", text: "Opportunities you apply to show here with their status.", action: { href: "/opportunities", label: "Browse opportunities" } },
  saved: { title: "Nothing saved", text: "Tap the bookmark on a listing to keep it here.", action: { href: "/opportunities", label: "Browse opportunities" } },
};

async function List({ searchParams }: { searchParams: PageProps<"/opportunities/mine">["searchParams"] }) {
  await requireClientViewer("/opportunities/mine");
  const raw = (await searchParams).tab;
  const tab: Tab = raw === "applied" || raw === "saved" ? raw : "posted";
  const page = await settle(apiGet<Page<OpportunitySummary>>("/me/opportunities", { tab }));
  const empty = empties[tab];
  return (
    <>
      <nav aria-label="My opportunities" className="flex gap-2">
        {TABS.map((t) => (
          <Link
            key={t.value}
            href={t.value === "posted" ? "/opportunities/mine" : `/opportunities/mine?tab=${t.value}`}
            aria-current={t.value === tab ? "page" : undefined}
            className={cn(
              "rounded-full border px-4 py-1.5 text-sm transition-colors",
              t.value === tab ? "border-primary bg-primary text-inverse" : "border-line bg-card text-body hover:border-line-strong",
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      {page.ok ? (
        <OpportunityList
          key={tab}
          path="/me/opportunities"
          query={{ tab }}
          initial={page.data}
          showStatus={tab === "posted"}
          dropUnsaved={tab === "saved"}
          empty={
            <EmptyState
              icon="briefcase"
              title={empty.title}
              actions={
                <Link href={empty.action.href} className={buttonClasses({ size: "small" })}>
                  {empty.action.label}
                </Link>
              }
            >
              {empty.text}
            </EmptyState>
          }
        />
      ) : (
        <SectionError message={errorMessage(page.error)} retryHref="/opportunities/mine" />
      )}
    </>
  );
}

/** Your listings (with applicant counts), your applications and your saved listings. */
export default function MyOpportunitiesPage({ searchParams }: PageProps<"/opportunities/mine">) {
  return (
    <PageShell>
      <PageHeader
        title="My opportunities"
        description="Listings you posted, opportunities you applied to, and ones you saved."
        actions={
          <Link href="/opportunities/new" className={buttonClasses({ variant: "accent" })}>
            Post an opportunity
          </Link>
        }
      />
      <Suspense fallback={<PanelSkeleton className="h-[320px]" lines={5} />}>
        <List searchParams={searchParams} />
      </Suspense>
    </PageShell>
  );
}
