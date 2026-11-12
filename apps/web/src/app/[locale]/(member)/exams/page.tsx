import type { Metadata } from "next";
import { Suspense } from "react";
import type { ExamSummary } from "@chartermission/contracts";
import { Chip } from "@chartermission/ui";
import { PageShell } from "@/components/discover/page-shell";
import { ExamCard } from "@/components/exams/exam-card";
import { settle } from "@/components/social/data";
import { errorMessage } from "@/components/social/error-message";
import { Bone, EmptyState, LoadingStatus, SectionError } from "@/components/social/skeletons";
import { Toaster } from "@/components/social/toast";
import { apiGet, requireViewer } from "@/lib/api/server";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Exams"), description: t("Practice exams and course exams you can take on Charter Mission, with your score straight away.") };
}

const gridClass = "grid grid-cols-3 gap-4 max-lg:grid-cols-2 max-sm:grid-cols-1";

async function ExamList() {
  const t = await getT();
  await requireViewer("/exams");
  const exams = await settle(apiGet<ExamSummary[]>("/exams"));
  if (!exams.ok) return <SectionError message={t("Exams couldn’t load. {error}", { error: errorMessage(exams.error) })} retryHref="/exams" />;
  if (!exams.data.length) {
    return (
      <EmptyState icon="clipboard" illustration={false} title="No exams are open right now" className="py-16">
        New exams appear here as soon as they open.
      </EmptyState>
    );
  }
  return (
    <ul className={gridClass}>
      {exams.data.map((exam) => (
        <li key={exam.id} className="flex">
          <ExamCard exam={exam} />
        </li>
      ))}
    </ul>
  );
}

/** Exams members can take on Charter Mission (GET /exams). */
export default function ExamsPage() {
  return (
    <PageShell className="gap-6 max-sm:px-4 max-sm:pt-5">
      <header className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="text-h1 text-ink">Exams</h1>
          <Chip tone="hashtag">With Charter Center</Chip>
        </div>
        <p className="text-md text-secondary">Practice exams and course exams you can take here. You get your score as soon as you finish.</p>
      </header>
      <Suspense
        fallback={
          <>
            <LoadingStatus label="Loading exams" />
            <div aria-hidden="true" className={gridClass}>
              {[0, 1, 2].map((i) => (
                <Bone key={i} className="h-[190px] w-full rounded-card" />
              ))}
            </div>
          </>
        }
      >
        <ExamList />
      </Suspense>
      <Toaster />
    </PageShell>
  );
}
