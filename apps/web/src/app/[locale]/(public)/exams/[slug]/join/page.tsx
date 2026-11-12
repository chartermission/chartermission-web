import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import type { ExamJoinInfo } from "@chartermission/contracts";
import { AuthFormSkeleton, AuthShell } from "@/components/auth/auth-shell";
import { ExamJoinFlow } from "@/components/exams/exam-join-flow";
import { apiGetOrNull, getViewer } from "@/lib/api/server";

type Props = PageProps<"/[locale]/exams/[slug]/join">;

const SLUG = /^[a-z0-9][a-z0-9-]{0,99}$/i;

export const metadata: Metadata = {
  title: "Take your exam",
  description: "Charter Center students take their exams on Charter Mission.",
  robots: { index: false },
};

const highlights = [
  "Use the email of your Charter Center account",
  "Your account is made from your Charter Center name and photo",
  "Pass, and your certificate arrives here to download",
  "Meet professionals in 54 countries and the diaspora",
];

async function Join({ params }: { params: Props["params"] }) {
  const { slug } = await params;
  if (!SLUG.test(slug)) notFound();
  // Members who are already signed in go straight to the exam.
  const viewer = await getViewer().catch(() => null);
  if (viewer) redirect(`/exams/${slug.toLowerCase()}`);
  const exam = await apiGetOrNull<ExamJoinInfo>(`/exam-join/${encodeURIComponent(slug)}`);
  if (!exam) notFound();
  return <ExamJoinFlow exam={exam} />;
}

/** Where Charter Center exam invitations land: join with the Charter Center email, then take the exam. */
export default function ExamJoinPage({ params }: Props) {
  return (
    <AuthShell heading="Take your Charter Center exam on Charter Mission" highlights={highlights}>
      <Suspense fallback={<AuthFormSkeleton rows={2} />}>
        <Join params={params} />
      </Suspense>
    </AuthShell>
  );
}
