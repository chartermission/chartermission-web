import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import type { AdminExamDetail } from "@chartermission/contracts";
import { ExamEditor } from "@/components/exams/exam-editor";
import { SkeletonCard } from "@/components/skeletons";
import { EmptyState, LoadError, NoAccess } from "@/components/states";
import { ApiError } from "@/lib/api/errors";
import { apiGetOrNull, requireViewer } from "@/lib/api/server";
import { PERM, can } from "@/lib/permissions";

export const metadata: Metadata = { title: "Exam" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function NotFound() {
  return (
    <div className="rounded-card border border-line bg-card">
      <EmptyState icon="clipboard" title="Exam not found">
        It may have been deleted.{" "}
        <Link href="/exams" className="text-primary hover:underline">
          Back to all exams
        </Link>
      </EmptyState>
    </div>
  );
}

async function Exam({ params }: Pick<PageProps<"/exams/[id]">, "params">) {
  const { id } = await params;
  const viewer = await requireViewer(`/exams/${id}`);
  if (!can(viewer, PERM.examManage)) return <NoAccess section="exams" />;
  if (!UUID.test(id)) return <NotFound />;
  let exam: AdminExamDetail | null;
  try {
    exam = await apiGetOrNull<AdminExamDetail>(`/admin/exams/${id}`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) return <NoAccess section="exams" />;
    return <LoadError message={e instanceof ApiError ? e.message : "This exam couldn’t be loaded."} />;
  }
  if (!exam) return <NotFound />;
  return <ExamEditor key={exam.id} initial={exam} />;
}

/** One exam: its questions, settings and members' results. */
export default function ExamPage(props: PageProps<"/exams/[id]">) {
  return (
    <Suspense
      fallback={
        <div className="flex flex-col gap-5">
          <SkeletonCard lines={2} />
          <SkeletonCard lines={8} />
        </div>
      }
    >
      <Exam params={props.params} />
    </Suspense>
  );
}
