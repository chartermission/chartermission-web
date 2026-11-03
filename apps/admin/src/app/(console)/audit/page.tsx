import { Suspense } from "react";
import type { Metadata } from "next";
import type { AuditEntry, Page } from "@chartermission/contracts";
import { AuditLog, AuditLogSkeleton } from "@/components/audit/audit-log";
import { PageHeader } from "@/components/shell/page-header";
import { ErrorState, NoAccess } from "@/components/states";
import { ApiError } from "@/lib/api/errors";
import { apiGet, requireViewer } from "@/lib/api/server";
import { AUDIT_PAGE_SIZE, auditApiQuery, auditSearch, parseAuditFilters, type AuditFilters } from "@/lib/audit";
import { PERM, can } from "@/lib/permissions";

export const metadata: Metadata = { title: "Audit log" };

async function AuditEntries({ searchParams }: Pick<PageProps<"/audit">, "searchParams">) {
  const filters: AuditFilters = parseAuditFilters(await searchParams);
  const viewer = await requireViewer(`/audit${auditSearch(filters)}`);
  if (!can(viewer, PERM.auditView)) return <NoAccess section="the audit log" />;
  let page: Page<AuditEntry>;
  try {
    page = await apiGet<Page<AuditEntry>>("/admin/audit", { ...auditApiQuery(filters), limit: AUDIT_PAGE_SIZE });
  } catch (e) {
    return (
      <div className="rounded-card border border-line bg-card">
        <ErrorState message={e instanceof ApiError ? e.message : "The audit log couldn’t be loaded."} />
      </div>
    );
  }
  return (
    <AuditLog
      key={auditSearch(filters) || "all"}
      filters={filters}
      initialItems={page.items}
      initialCursor={page.nextCursor}
      canExport={can(viewer, PERM.auditExport)}
    />
  );
}

/** Append-only audit log viewer with filters and CSV export (CM-ADM-09). */
export default function AuditPage(props: PageProps<"/audit">) {
  return (
    <>
      <PageHeader
        title="Audit log"
        description="Every sign-in, moderation action, appeal decision and trending change, newest first. Entries can’t be edited or deleted."
      />
      <Suspense fallback={<AuditLogSkeleton />}>
        <AuditEntries searchParams={props.searchParams} />
      </Suspense>
    </>
  );
}
