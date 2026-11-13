"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { ExamJoinInfo, ExamSummary } from "@chartermission/contracts";
import { Icon, buttonClasses } from "@chartermission/ui";
import { api, isApiError } from "@/lib/api/client";
import { toast } from "@/components/social/toast";
import { INVITE_EXAM_COOKIE } from "@/lib/invite";
import { NoTranslate } from "@/i18n/auto";
import { useT } from "@/i18n/client";
import { examHref } from "./format";

/*
 * Exam invitation links (/exams/{slug}/join). The proxy remembers the exam in a cookie for 30 days.
 * A member who is signed in gets the exam at once (POST /exams/:slug/access) and lands on it; someone
 * signed out signs in or creates an account first, and ExamInviteClaim gives them the exam as soon
 * as they are in, wherever they land.
 */

const SLUG = /^[a-z0-9][a-z0-9-]{0,99}$/;

function readInviteCookie(): string | null {
  const raw = document.cookie.split("; ").find((c) => c.startsWith(`${INVITE_EXAM_COOKIE}=`));
  const slug = raw ? decodeURIComponent(raw.slice(INVITE_EXAM_COOKIE.length + 1)).toLowerCase() : null;
  return slug && SLUG.test(slug) ? slug : null;
}

function clearInviteCookie() {
  document.cookie = `${INVITE_EXAM_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
}

/** Gives the signed-in member the exam; false when the link doesn't lead to an open exam. */
async function claim(slug: string): Promise<ExamSummary | null> {
  try {
    return await api<ExamSummary>(`/exams/${encodeURIComponent(slug)}/access`, { method: "POST" });
  } catch (e) {
    if (isApiError(e, "NOT_FOUND")) return null;
    throw e;
  }
}

/** The invitation page for a signed-in member: adds the exam, then opens it. */
export function ClaimExam({ slug }: { slug: string }) {
  const router = useRouter();
  const [failed, setFailed] = useState<"gone" | "error" | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    claim(slug)
      .then((exam) => {
        clearInviteCookie();
        if (!exam) return setFailed("gone");
        router.replace(examHref(exam.slug));
      })
      .catch(() => setFailed("error"));
  }, [slug, router]);

  if (failed === "gone") {
    return (
      <div className="flex flex-col gap-3">
        <h2 className="text-h3 text-ink">This exam isn’t open</h2>
        <p className="text-sm text-secondary">The link may be wrong, or the exam has closed. Ask whoever sent it for a new link.</p>
        <Link href="/learning" className={buttonClasses({ variant: "secondary" })}>
          Go to Learning
        </Link>
      </div>
    );
  }
  if (failed === "error") {
    return (
      <div className="flex flex-col gap-3">
        <h2 className="text-h3 text-ink">We couldn’t add the exam</h2>
        <p className="text-sm text-secondary">Check your connection and try again.</p>
        <button type="button" onClick={() => location.reload()} className={buttonClasses({ variant: "primary" })}>
          Try again
        </button>
      </div>
    );
  }
  return (
    <p role="status" className="flex items-center gap-2 text-sm text-secondary">
      <Icon name="clock" size={16} />
      Adding the exam to your Learning page…
    </p>
  );
}

/**
 * In the member layout: someone who opened an exam link while signed out, then signed in or
 * created an account, gets the exam here and is taken to it.
 */
export function ExamInviteClaim() {
  const router = useRouter();
  const t = useT();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const slug = readInviteCookie();
    if (!slug) return;
    claim(slug)
      .then((exam) => {
        clearInviteCookie();
        if (!exam) return;
        toast.success(t("“{title}” is now on your Learning page", { title: exam.title }));
        if (!location.pathname.startsWith(examHref(exam.slug))) router.push(examHref(exam.slug));
      })
      // Offline or a hiccup: the cookie stays, so the next page tries again.
      .catch(() => undefined);
  }, [router, t]);

  return null;
}

/** The invitation page for someone signed out: the exam, then sign in or create an account. */
export function ExamInviteSignedOut({ exam }: { exam: ExamJoinInfo }) {
  const t = useT();
  const back = `/exams/${exam.slug}/join`;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <span className="flex w-fit items-center gap-1.5 rounded-full bg-primary-tint-2 px-3 py-1 text-xs font-semibold text-primary-light">
          <Icon name="clipboard" size={14} />
          Charter Center exam
        </span>
        <h1 className="text-h1 text-ink max-sm:text-h2">
          <NoTranslate>
            <bdi>{exam.title}</bdi>
          </NoTranslate>
        </h1>
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-secondary">
          <span>{t("{count} questions", { count: exam.questionCount })}</span>
          {exam.timeLimitMinutes && <span>{t("{count} minutes", { count: exam.timeLimitMinutes })}</span>}
          <span>{t("Pass mark {percent}%", { percent: exam.passPercent })}</span>
        </p>
        <p className="flex items-start gap-2 rounded-[10px] bg-primary-tint-2 p-3 text-sm text-ink">
          <Icon name="verified" size={16} className="mt-0.5 shrink-0 text-primary-light" />
          Pass it to receive your Charter Center certificate.
        </p>
      </div>
      <div className="flex flex-col gap-3">
        <p className="text-md text-body">You’ve been invited to take this exam. Create your free Charter Mission account, or sign in, and it will be waiting on your Learning page.</p>
        <Link href="/signup" className={buttonClasses({ variant: "primary", block: true })}>
          Create your account
        </Link>
        <Link href={`/signin?next=${encodeURIComponent(back)}`} className={buttonClasses({ variant: "secondary", block: true })}>
          I already have an account
        </Link>
      </div>
    </div>
  );
}
