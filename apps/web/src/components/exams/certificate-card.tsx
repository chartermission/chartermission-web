"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import type { ExamCertificateView } from "@chartermission/contracts";
import { Button, Icon, Panel, buttonClasses, cn } from "@chartermission/ui";
import { api } from "@/lib/api/client";
import { NameCheckPanel, SLOT, Sentence } from "./certificate-name";
import { openShare } from "@/components/social/share-out";
import { toast } from "@/components/social/toast";
import { NoTranslate } from "@/i18n/auto";
import { useT } from "@/i18n/client";

/** Asks again every few seconds while Charter Center prepares the certificate, then less often. */
const POLL_MS = [4000, 4000, 6000, 8000, 10_000, 15_000, 30_000];

/**
 * The member's Charter Center certificate for an exam they passed: on its way (checked again while
 * the page is open), ready to download, or not available. Once issued it can always be shared: on
 * the feed (again, if they deleted the first post) and, through that public post, on LinkedIn,
 * WhatsApp, X and the rest.
 *
 * While the member has to confirm the name printed on it (`nameCheck`), that comes first: nothing is
 * sent to Charter Center until they do. An issued certificate they're asked to check stays below.
 * The whole card is `#certificate`, where the notice and email about the name link to.
 */
export function CertificateCard({
  examId,
  examTitle,
  initial,
  finishProfile = false,
  className,
}: {
  examId: string;
  /** For the line that goes with the link when it's shared elsewhere. */
  examTitle?: string;
  initial: ExamCertificateView | null;
  /** The member joined from an invitation and hasn't finished their profile yet. */
  finishProfile?: boolean;
  className?: string;
}) {
  const t = useT();
  const [cert, setCert] = useState(initial);
  const [posting, setPosting] = useState(false);
  // Nothing is asked of Charter Center while the name is unconfirmed or being checked.
  const waiting = !cert || (cert.status === "pending" && !cert.nameCheck);

  function shareOut(postId: string) {
    const line = examTitle
      ? t("I passed “{exam}” and earned my Charter Center certificate.", { exam: examTitle })
      : t("I earned my Charter Center certificate.");
    openShare({ path: `/posts/${postId}`, title: line, text: line, send: { type: "post", key: postId } });
  }

  async function shareToFeed() {
    setPosting(true);
    try {
      const next = await api<ExamCertificateView>(`/exams/${examId}/certificate/post`, { method: "POST" });
      setCert(next);
      toast.success("Shared on your feed");
      if (next.postId) shareOut(next.postId);
    } catch (e) {
      toast.error(e);
    } finally {
      setPosting(false);
    }
  }

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

  const nameCheck = cert?.nameCheck ? <NameCheckPanel key={`${cert.nameCheck.status}:${cert.nameCheck.proposedName ?? ""}`} examId={examId} check={cert.nameCheck} onChange={setCert} /> : null;

  const wrap = (content: ReactNode) => (
    <div id="certificate" className={cn("flex scroll-mt-24 flex-col gap-4", className)}>
      {nameCheck}
      {content}
    </div>
  );

  if (cert?.status === "issued") {
    // Members who joined from an invitation finish their profile before the rest of the site opens.
    const postHref = cert.postId ? (finishProfile ? `/onboarding?next=${encodeURIComponent(`/posts/${cert.postId}`)}` : `/posts/${cert.postId}`) : null;
    const finishHref = postHref && finishProfile ? postHref : "/onboarding";
    return wrap(
      <Panel aria-labelledby="certificate-heading" className="flex flex-wrap items-center gap-6 p-5 max-sm:p-4">
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
            {cert.postId ? (
              <>
                <Button variant="secondary" onClick={() => shareOut(cert.postId!)}>
                  <Icon name="share" size={18} />
                  Share
                </Button>
                {postHref && (
                  <Link href={postHref} className={buttonClasses({ variant: "secondary" })}>
                    <Icon name="arrow-up-right" size={18} className="rtl:-scale-x-100" />
                    See it on the feed
                  </Link>
                )}
              </>
            ) : (
              <Button variant="secondary" disabled={posting} onClick={() => void shareToFeed()}>
                <Icon name="share" size={18} />
                {posting ? t("Sharing…") : t("Share to feed")}
              </Button>
            )}
          </div>
          <p className="text-xs text-secondary">
            {cert.postId
              ? "It’s on your feed as a public post, so you can share it on LinkedIn, WhatsApp and elsewhere. You can edit or delete the post like any other."
              : "Share it on your feed so the community can congratulate you. It’s a public post, so you can then share it on LinkedIn, WhatsApp and elsewhere."}
          </p>
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
      </Panel>,
    );
  }

  // Asked to confirm the name before anything is sent: the name panel takes the place of the rest.
  if (cert?.nameCheck) return wrap(null);

  if (cert?.status === "failed") {
    return wrap(
      <Panel role="status" className="flex items-start gap-3 p-5 max-sm:p-4">
        <Icon name="alert" size={20} className="mt-0.5 shrink-0 text-warning" />
        <div className="flex flex-col gap-1">
          <h2 className="text-md font-semibold text-ink">Your certificate isn’t here yet</h2>
          <p className="text-sm text-body">Charter Center hasn’t sent it to us yet. The Charter Mission team can see this and will follow it up. We’ll email you when it arrives.</p>
        </div>
      </Panel>,
    );
  }

  return wrap(
    <Panel role="status" aria-live="polite" className="flex items-start gap-3 p-5 max-sm:p-4">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-tint-2 text-primary-light">
        <Icon name="clipboard" size={20} />
      </span>
      <div className="flex flex-col gap-1">
        <h2 className="text-md font-semibold text-ink">Your certificate is on its way</h2>
        <p className="text-sm text-body">
          Charter Center is preparing your certificate. It appears here, and we email you, as soon as it’s ready. It’s also shared on the feed so the community can congratulate you.
        </p>
        {cert?.name && (
          <p className="text-xs text-secondary">
            <Sentence text={t("Name on your certificate: {name}", { name: SLOT })} value={cert.name} />
          </p>
        )}
      </div>
    </Panel>,
  );
}
