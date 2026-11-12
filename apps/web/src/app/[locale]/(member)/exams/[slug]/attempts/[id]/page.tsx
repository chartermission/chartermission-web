import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import type { ExamAttemptView } from "@chartermission/contracts";
import { Icon } from "@chartermission/ui";
import { PageShell } from "@/components/discover/page-shell";
import { AttemptScreen } from "@/components/exams/attempt-screen";
import { examHref } from "@/components/exams/format";
import { Bone, LoadingStatus } from "@/components/social/skeletons";
import { Toaster } from "@/components/social/toast";
import { apiGetOrNull, requireViewer } from "@/lib/api/server";

type Props = PageProps<"/[locale]/exams/[slug]/attempts/[id]">;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9][a-z0-9-]{0,99}$/i;

export const metadata: Metadata = { title: "Exam", robots: { index: false } };

async function Attempt({ params }: { params: Props["params"] }) {
  const { slug, id } = await params;
  if (!SLUG.test(slug) || !UUID.test(id)) notFound();
  const viewer = await requireViewer(`/exams/${slug}/attempts/${id}`);
  const attempt = await apiGetOrNull<ExamAttemptView>(`/exam-attempts/${id}`);
  if (!attempt) notFound();
  return (
    <>
      <Link href={examHref(attempt.exam.slug)} className="flex w-fit items-center gap-1.5 rounded-sm text-sm font-medium text-primary-light hover:underline">
        <Icon name="chevron-left" size={18} className="rtl:rotate-180" />
        Exam details
      </Link>
      <AttemptScreen key={attempt.id} initial={attempt} finishProfile={!viewer.onboarding.completed} />
    </>
  );
}

/** Taking an exam, and its result afterwards (GET /exam-attempts/:id). */
export default function ExamAttemptPage({ params }: Props) {
  return (
    <PageShell className="gap-4 max-sm:px-4 max-sm:pt-4">
      <Suspense
        fallback={
          <>
            <LoadingStatus label="Loading the exam" />
            <div aria-hidden="true" className="flex flex-col gap-4">
              <Bone className="h-8 w-[50%]" />
              <Bone className="h-12 w-full rounded-card" />
              <Bone className="h-[420px] w-full rounded-card" />
            </div>
          </>
        }
      >
        <Attempt params={params} />
      </Suspense>
      <Toaster />
    </PageShell>
  );
}
