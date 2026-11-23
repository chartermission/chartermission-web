import { Suspense, cache } from "react";
import type { Metadata } from "next";
import type { AdminBadge, AdminMembersPage, Taxonomies } from "@chartermission/contracts";
import { MembersConsole, MembersTotal } from "@/components/members/members-console";
import { PageHeader } from "@/components/shell/page-header";
import { SkeletonTable } from "@/components/skeletons";
import { LoadError, NoAccess } from "@/components/states";
import { ApiError } from "@/lib/api/errors";
import { apiGet, requireViewer } from "@/lib/api/server";
import { MEMBERS_PAGE_SIZE, membersApiQuery, membersSearch, parseMembersFilters, type MembersFilters } from "@/lib/members-filters";
import { PERM, can } from "@/lib/permissions";

export const metadata: Metadata = { title: "Members" };

/** The first page with its counts, for the filters in the URL; the header and the list share one request. */
const firstPage = cache((search: string) =>
  apiGet<AdminMembersPage>("/admin/members", { ...membersApiQuery(parseMembersFilters(Object.fromEntries(new URLSearchParams(search)))), limit: MEMBERS_PAGE_SIZE }),
);

/** "12,345 members" beside the title: every account except deleted ones. */
async function HeaderTotal({ searchParams }: Pick<PageProps<"/members">, "searchParams">) {
  const filters = parseMembersFilters(await searchParams);
  const viewer = await requireViewer(`/members${membersSearch(filters)}`);
  if (!can(viewer, PERM.membersManage)) return null;
  const page = await firstPage(membersSearch(filters)).catch(() => null);
  return page?.counts ? <MembersTotal count={page.counts.all} /> : null;
}

async function Members({ searchParams }: Pick<PageProps<"/members">, "searchParams">) {
  const filters: MembersFilters = parseMembersFilters(await searchParams);
  const viewer = await requireViewer(`/members${membersSearch(filters)}`);
  if (!can(viewer, PERM.membersManage)) return <NoAccess section="members" />;
  let data: [AdminMembersPage, AdminBadge[], Taxonomies | null];
  try {
    data = await Promise.all([
      firstPage(membersSearch(filters)),
      apiGet<AdminBadge[]>("/admin/badges"),
      // The Filters panel still works without its option lists.
      apiGet<Taxonomies>("/taxonomies").catch(() => null),
    ]);
  } catch (e) {
    return <LoadError message={e instanceof ApiError ? e.message : "Members couldn’t be loaded."} />;
  }
  return (
    <MembersConsole
      initial={data[0]}
      initialFilters={filters}
      badges={data[1]}
      taxonomies={data[2]}
      canManageBadges={can(viewer, PERM.badgesManage)}
      access={{ viewerId: viewer.id, canManageRoles: can(viewer, PERM.rolesManage), canAssignSuperAdmin: can(viewer, PERM.superadminAssign), canResetTwoStep: can(viewer, PERM.mfaReset), canMessage: can(viewer, PERM.membersMessage) }}
    />
  );
}

/** Member controls: filters, batch changes, verified tick, badges and who's suggested to people signing up. */
export default function MembersPage(props: PageProps<"/members">) {
  return (
    <>
      <PageHeader
        title="Members"
        description="Verify members, award badges, give team access (moderator, admin) and choose who is suggested to new members when they sign up. Every change is in the audit log."
        actions={
          <Suspense fallback={null}>
            <HeaderTotal searchParams={props.searchParams} />
          </Suspense>
        }
      />
      <Suspense fallback={<SkeletonTable label="Loading members" rows={8} />}>
        <Members searchParams={props.searchParams} />
      </Suspense>
    </>
  );
}
