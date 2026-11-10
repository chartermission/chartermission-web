import { Suspense } from "react";
import type { Metadata } from "next";
import type { AdminVerificationRow, Page } from "@chartermission/contracts";
import { VerificationConsole } from "@/components/pages/verification-console";
import { PageHeader } from "@/components/shell/page-header";
import { SkeletonTable } from "@/components/skeletons";
import { LoadError, NoAccess } from "@/components/states";
import { ApiError } from "@/lib/api/errors";
import { apiGet, requireViewer } from "@/lib/api/server";
import { PERM, can } from "@/lib/permissions";

export const metadata: Metadata = { title: "Verification" };

async function Queue() {
  const viewer = await requireViewer("/verification");
  if (!can(viewer, PERM.membersManage)) return <NoAccess section="verification requests" />;
  let queue: Page<AdminVerificationRow>;
  try {
    queue = await apiGet<Page<AdminVerificationRow>>("/admin/verification", { status: "pending" });
  } catch (e) {
    return <LoadError message={e instanceof ApiError ? e.message : "Verification requests couldn’t be loaded."} />;
  }
  return <VerificationConsole initial={queue} />;
}

/** Applications for the verified tick, from members and from pages. */
export default function VerificationPage() {
  return (
    <>
      <PageHeader
        title="Verification"
        description="Members and pages apply for the verified tick. Check that the name and links match who they say they are, then approve or decline with a note."
      />
      <Suspense fallback={<SkeletonTable label="Loading requests" rows={4} />}>
        <Queue />
      </Suspense>
    </>
  );
}
