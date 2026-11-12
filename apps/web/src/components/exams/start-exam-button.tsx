"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ExamAttemptView } from "@chartermission/contracts";
import { Button, Icon, type ButtonVariant } from "@chartermission/ui";
import { ConfirmDialog } from "@/components/social/confirm-dialog";
import { toast } from "@/components/social/toast";
import { api } from "@/lib/api/client";
import { useT } from "@/i18n/client";
import { attemptHref } from "./format";

/**
 * Starts an attempt (POST /exams/:id/attempts) and opens it. A timed exam asks first, because the
 * clock starts at once; an attempt already in progress is simply reopened.
 */
export function StartExamButton({
  examId,
  slug,
  label,
  timeLimitMinutes,
  resumeAttemptId,
  variant = "accent",
  block = false,
}: {
  examId: string;
  slug: string;
  label: string;
  timeLimitMinutes: number | null;
  /** The attempt in progress, if there is one: no question asked, straight back in. */
  resumeAttemptId?: string | null;
  variant?: ButtonVariant;
  block?: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function start() {
    const attempt = await api<ExamAttemptView>(`/exams/${examId}/attempts`, { method: "POST" });
    router.push(attemptHref(slug, attempt.id));
  }

  async function onClick() {
    if (resumeAttemptId) return router.push(attemptHref(slug, resumeAttemptId));
    if (timeLimitMinutes) return setConfirming(true);
    setBusy(true);
    try {
      await start();
    } catch (e) {
      toast.error(e);
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant={variant} block={block} disabled={busy} aria-busy={busy} onClick={() => void onClick()}>
        {busy ? t("Starting…") : label}
        <Icon name="chevron-right" size={18} className="rtl:rotate-180" />
      </Button>
      {confirming && (
        <ConfirmDialog title={t("Ready to start?")} confirmLabel={t("Start the exam")} onClose={() => setConfirming(false)} onConfirm={start}>
          {t("You have {count} minutes. The clock starts now and keeps running if you leave the page. Your answers are saved as you go, and the exam is handed in automatically when the time is up.", {
            count: timeLimitMinutes ?? 0,
          })}
        </ConfirmDialog>
      )}
    </>
  );
}
