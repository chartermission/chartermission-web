import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import type { GroupDetail, GroupSummary, Page } from "@chartermission/contracts";
import { Icon, buttonClasses } from "@chartermission/ui";
import { PageHeader, PageShell } from "@/components/discover/page-shell";
import { GroupsHub, type PendingCounts } from "@/components/groups/groups-hub";
import { settle } from "@/components/social/data";
import { LoadingStatus, PanelSkeleton } from "@/components/social/skeletons";
import { Toaster } from "@/components/social/toast";
import { apiGet, requireViewer } from "@/lib/api/server";
import { getTaxonomies } from "@/lib/taxonomies";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: t("Groups"),
    description: t("Communities around shared interests, run by members, pages and chapters."),
  };
}

const list = (scope: string, limit = 50) => apiGet<Page<GroupSummary>>("/groups", { scope, limit }).then((page) => page.items);

async function GroupsMain() {
  await requireViewer("/groups");
  const [suggested, all, mine, invited, requested, managed, taxonomies] = await Promise.all([
    settle(list("suggested", 6)),
    settle(apiGet<Page<GroupSummary>>("/groups", { scope: "all", limit: 24 })),
    settle(list("mine")),
    settle(list("invited")),
    settle(list("requested")),
    settle(list("managed", 20)),
    settle(getTaxonomies()),
  ]);

  // What waits for the viewer in the groups they run (join requests, posts to approve).
  const pending: PendingCounts = {};
  if (managed.ok) {
    const details = await Promise.all(managed.data.map((group) => settle(apiGet<GroupDetail>(`/groups/${group.slug}`))));
    for (const detail of details) if (detail.ok && detail.data.pending) pending[detail.data.id] = detail.data.pending;
  }

  const countries = taxonomies.ok ? taxonomies.data.countries.map(({ code, name }) => ({ code, name })).sort((a, b) => a.name.localeCompare(b.name)) : [];

  return (
    <GroupsHub
      suggested={suggested.ok ? suggested.data : []}
      all={all}
      mine={mine}
      invited={invited}
      requested={requested}
      pending={pending}
      countries={countries}
    />
  );
}

/** Groups: communities members, pages and chapters run around a shared interest. */
export default function GroupsIndex() {
  return (
    <PageShell className="max-sm:px-3 max-sm:pt-4">
      <PageHeader
        title="Groups"
        description="Communities around shared interests, run by members, pages and chapters."
        actions={
          <Link href="/groups/new" className={buttonClasses({ className: "max-sm:px-3" })}>
            <Icon name="plus" size={18} />
            <span className="max-sm:sr-only">Create a group</span>
          </Link>
        }
      />
      <Suspense
        fallback={
          <>
            <LoadingStatus label="Loading groups" />
            <div className="grid grid-cols-3 gap-4 max-lg:grid-cols-2 max-sm:grid-cols-1">
              {Array.from({ length: 6 }, (_, i) => (
                <PanelSkeleton key={i} className="h-[240px]" lines={3} />
              ))}
            </div>
          </>
        }
      >
        <GroupsMain />
      </Suspense>
      <Toaster />
    </PageShell>
  );
}
