import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import type { ExamJoinInfo } from "@chartermission/contracts";
import { AuthFormSkeleton, AuthShell } from "@/components/auth/auth-shell";
import { ClaimExam, ExamInviteSignedOut } from "@/components/exams/exam-invite";
import { apiGetOrNull, getViewer } from "@/lib/api/server";

type Props = PageProps<"/[locale]/exams/[slug]/join">;

const SLUG = /^[a-z0-9][a-z0-9-]{0,99}$/i;

export const metadata: Metadata = {
  title: "Take your exam",
  description: "Charter Center students take their exams on Charter Mission.",
  robots: { index: false },
};

const highlights = [
  "Your exam waits on your Learning page",
  "Your score as soon as you finish",
  "Pass, and your Charter Center certificate arrives here to download",
  "Meet professionals in 54 countries and the diaspora",
];

async function Invite({ params }: { params: Props["params"] }) {
  const { slug } = await params;
  if (!SLUG.test(slug)) notFound();
  // Members who are signed in get the exam straight away and land on it.
  const viewer = await getViewer().catch(() => null);
  if (viewer) return <ClaimExam slug={slug.toLowerCase()} />;
  const exam = await apiGetOrNull<ExamJoinInfo>(`/exam-join/${encodeURIComponent(slug)}`);
  if (!exam) notFound();
  return <ExamInviteSignedOut exam={exam} />;
}

/**
 * An exam's invitation link. The exam is only for people who open this link: signed in, it is added
 * to their Learning page; signed out, they sign in or create an account first (the proxy remembers
 * the exam in a cookie, and it is added as soon as they are in).
 */
export default function ExamInvitePage({ params }: Props) {
  return (
    <AuthShell heading="Take your Charter Center exam on Charter Mission" highlights={highlights}>
      <Suspense fallback={<AuthFormSkeleton rows={2} />}>
        <Invite params={params} />
      </Suspense>
    </AuthShell>
  );
}
