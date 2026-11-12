import { Suspense } from "react";
import type { Metadata } from "next";
import type { AdminExamSummary, ExamsAdminSettings } from "@chartermission/contracts";
import { CharterCenterPanel } from "@/components/exams/charter-center-panel";
import { ExamsConsole } from "@/components/exams/exams-console";
import { PageHeader } from "@/components/shell/page-header";
import { SkeletonTable } from "@/components/skeletons";
import { LoadError, NoAccess } from "@/components/states";
import { ApiError } from "@/lib/api/errors";
import { apiGet, requireViewer } from "@/lib/api/server";
import { PERM, can } from "@/lib/permissions";

export const metadata: Metadata = { title: "Exams" };

async function Exams() {
  const viewer = await requireViewer("/exams");
  if (!can(viewer, PERM.examManage)) return <NoAccess section="exams" />;
  let rows: AdminExamSummary[];
  let settings: ExamsAdminSettings | null;
  try {
    [rows, settings] = await Promise.all([
      apiGet<AdminExamSummary[]>("/admin/exams"),
      apiGet<ExamsAdminSettings>("/admin/exams-settings").catch(() => null),
    ]);
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) return <NoAccess section="exams" />;
    return <LoadError message={e instanceof ApiError ? e.message : "Exams couldn’t be loaded."} />;
  }
  return (
    <>
      {settings && <CharterCenterPanel initial={settings} />}
      <ExamsConsole initial={rows} />
    </>
  );
}

/** Exams members take on Charter Mission: the list, and the way into each exam's builder and results. */
export default function ExamsPage() {
  return (
    <>
      <PageHeader title="Exams" description="Multiple-choice exams members take on Charter Mission. Build one here, try it as a draft, then publish it." />
      <Suspense fallback={<SkeletonTable label="Loading exams" rows={4} />}>
        <Exams />
      </Suspense>
    </>
  );
}
