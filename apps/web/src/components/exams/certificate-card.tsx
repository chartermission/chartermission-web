"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ExamCertificateView } from "@chartermission/contracts";
import { Icon, Panel, buttonClasses, cn } from "@chartermission/ui";
import { api } from "@/lib/api/client";
import { NoTranslate } from "@/i18n/auto";

/** Asks again every few seconds while Charter Center prepares the certificate, then less often. */
const POLL_MS = [4000, 4000, 6000, 8000, 10_000, 15_000, 30_000];

/**
 * The member's Charter Center certificate for an exam they passed: on its way (checked again while
 * the page is open), ready to download and shared on their feed, or not available.
 */
export function CertificateCard({
  examId,
  initial,
  finishProfile = false,
  className,
}: {
  examId: string;
  initial: ExamCertificateView | null;
  /** The member joined from an invitation and hasn't finished their profile yet. */
  finishProfile?: boolean;
  className?: string;
}) {
  const [cert, setCert] = useState(initial);
  const waiting = !cert || cert.status === "pending";

  useEffect(() => {
    if (!waiting) return;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    const tick = async () => {
      try {
        const next = await api<ExamCertificateView | null>(`/exams/${examId}/certificate`);
        if (stopped) return;
        if (next) setCert(next);
        if (next && next.status !== "pending") return;
      } catch {
        // Keep the last known state; try again later.
      }
      if (stopped) return;
      timer = setTimeout(tick, POLL_MS[Math.min(tries++, POLL_MS.length - 1)]);
    };
    timer = setTimeout(tick, POLL_MS[0]);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [examId, waiting]);

  if (cert?.status === "issued") {
    // Members who joined from an invitation finish their profile before the rest of the site opens.
    const postHref = cert.postId ? (finishProfile ? `/onboarding?next=${encodeURIComponent(`/posts/${cert.postId}`)}` : `/posts/${cert.postId}`) : null;
    const finishHref = postHref && finishProfile ? postHref : "/onboarding";
    return (
      <Panel aria-labelledby="certificate-heading" className={cn("flex flex-wrap items-center gap-6 p-5 max-sm:p-4", className)}>
        {cert.imageUrl && (
          <a href={cert.imageUrl} target="_blank" rel="noopener" className="block w-[260px] shrink-0 overflow-hidden rounded-lg border border-line max-sm:w-full">
            {/* eslint-disable-next-line @next/next/no-img-element -- served by the API with its own access rules */}
            <img src={cert.imageUrl} alt="Your Charter Center certificate" className="block h-auto w-full" />
          </a>
        )}
        <div className="flex min-w-[220px] flex-1 flex-col gap-3">
          <div className="flex flex-col gap-1">
            <span className="flex w-fit items-center gap-1.5 rounded-full bg-success-light px-2.5 py-0.5 text-xs font-semibold text-success">
              <Icon name="check" size={14} />
              Certificate issued
            </span>
            <h2 id="certificate-heading" className="text-h3 text-ink">
              Your Charter Center certificate
            </h2>
            {cert.certificateId && (
              <p className="text-sm text-secondary">
                Certificate ID{" "}
                <NoTranslate>
                  <bdi className="font-medium text-ink">{cert.certificateId}</bdi>
                </NoTranslate>
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {cert.downloadUrl && (
              <a href={cert.downloadUrl} download className={buttonClasses({ variant: "primary" })}>
                <Icon name="download" size={18} />
                Download PDF
              </a>
            )}
            {postHref && (
              <Link href={postHref} className={buttonClasses({ variant: "secondary" })}>
                <Icon name="share" size={18} />
                See it on the feed
              </Link>
            )}
          </div>
          {cert.postId && <p className="text-xs text-secondary">We shared it on your behalf so the community can congratulate you. You can edit or delete the post like any other.</p>}
          {finishProfile && (
            <p className="flex items-start gap-2 rounded-[10px] bg-info-light p-3 text-sm text-body">
              <Icon name="user" size={16} className="mt-0.5 shrink-0 text-info" />
              <span>
                Finish your profile so people who congratulate you can see who you are. It takes two minutes, then the rest of Charter Mission opens.{" "}
                <Link href={finishHref} className="font-medium text-primary-light underline underline-offset-2">
                  Finish my profile
                </Link>
              </span>
            </p>
          )}
        </div>
      </Panel>
    );
  }

  if (cert?.status === "failed") {
    return (
      <Panel role="status" className={cn("flex items-start gap-3 p-5 max-sm:p-4", className)}>
        <Icon name="alert" size={20} className="mt-0.5 shrink-0 text-warning" />
        <div className="flex flex-col gap-1">
          <h2 className="text-md font-semibold text-ink">Your certificate isn’t here yet</h2>
          <p className="text-sm text-body">Charter Center hasn’t sent it to us yet. The Charter Mission team can see this and will follow it up. We’ll email you when it arrives.</p>
        </div>
      </Panel>
    );
  }

  return (
    <Panel role="status" aria-live="polite" className={cn("flex items-start gap-3 p-5 max-sm:p-4", className)}>
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-tint-2 text-primary-light">
        <Icon name="clipboard" size={20} />
      </span>
      <div className="flex flex-col gap-1">
        <h2 className="text-md font-semibold text-ink">Your certificate is on its way</h2>
        <p className="text-sm text-body">
          Charter Center is preparing your certificate. It appears here, and we email you, as soon as it’s ready. It’s also shared on the feed so the community can congratulate you.
        </p>
      </div>
    </Panel>
  );
}
