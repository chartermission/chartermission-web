import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import type { ExamInstructorList } from "@chartermission/contracts";
import { Icon } from "@chartermission/ui";
import { InstructorsConsole } from "@/components/exams/instructors";
import { PageHeader } from "@/components/shell/page-header";
import { SkeletonTable } from "@/components/skeletons";
import { LoadError, NoAccess } from "@/components/states";
import { ApiError } from "@/lib/api/errors";
import { apiGet, requireViewer } from "@/lib/api/server";
import { PERM, can } from "@/lib/permissions";

export const metadata: Metadata = { title: "Instructors" };

async function Instructors() {
  const viewer = await requireViewer("/exams/instructors");
  if (!can(viewer, PERM.examManage)) return <NoAccess section="exams" />;
  let list: ExamInstructorList;
  try {
    list = await apiGet<ExamInstructorList>("/admin/exam-instructors", { includeArchived: true });
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) return <NoAccess section="exams" />;
    return <LoadError message={e instanceof ApiError ? e.message : "Instructors couldn’t be loaded."} />;
  }
  return <InstructorsConsole initial={list.items} />;
}

/** Instructors who sign Charter Center certificates; each exam that awards one names an instructor. */
export default function InstructorsPage() {
  return (
    <>
      <Link href="/exams" className="flex w-fit items-center gap-1 rounded-sm text-sm font-medium text-primary hover:underline">
        <Icon name="chevron-left" size={16} className="rtl:rotate-180" />
        All exams
      </Link>
      <PageHeader
        title="Instructors"
        description="The people who sign Charter Center certificates. Changing a name or signature applies to every exam that uses it; certificates already issued can then be replaced."
      />
      <Suspense fallback={<SkeletonTable label="Loading instructors" rows={4} />}>
        <Instructors />
      </Suspense>
    </>
  );
}
