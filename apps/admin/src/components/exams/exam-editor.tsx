"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { AdminExamDetail, ExamStatus } from "@chartermission/contracts";
import { Button, Chip, Icon, SegmentedControl, buttonClasses } from "@chartermission/ui";
import { FormNotice } from "@/components/form-field";
import { ReasonDialog } from "@/components/reason-dialog";
import { toast } from "@/components/toast";
import { api } from "@/lib/api/client";
import { webHref } from "@/lib/navigation";
import { useT } from "@/i18n/client";
import { STATUS_CHIP, examFacts } from "./exam-labels";
import { ExamQuestions } from "./exam-questions";
import { ExamResults } from "./exam-results";
import { ExamInvites } from "./exam-invites";
import { ExamSettings } from "./exam-settings";

type Tab = "questions" | "settings" | "invite" | "results";
type Confirm = "publish" | "unpublish" | "archive" | "delete";

/**
 * One exam in the console (GET /admin/exams/:id): questions, settings and results, with the
 * publish / unpublish / archive / delete actions. Every change returns the whole exam, which
 * replaces the copy held here.
 */
export function ExamEditor({ initial }: { initial: AdminExamDetail }) {
  const t = useT();
  const router = useRouter();
  const [exam, setExam] = useState(initial);
  const [tab, setTab] = useState<Tab>("questions");
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const chip = STATUS_CHIP[exam.status];
  const taken = exam.stats.attempts > 0;

  async function setStatus(status: ExamStatus, done: string) {
    setExam(await api<AdminExamDetail>(`/admin/exams/${exam.id}`, { method: "PATCH", body: { status } }));
    toast(done);
    setConfirm(null);
    router.refresh();
  }

  const small = (variant: "primary" | "secondary" | "ghost" = "secondary") => ({ variant, size: "small" as const });

  return (
    <>
      <Link href="/exams" className="flex w-fit items-center gap-1 rounded-sm text-sm font-medium text-primary hover:underline">
        <Icon name="chevron-left" size={16} className="rtl:rotate-180" />
        All exams
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-h1 text-ink">{exam.title}</h1>
            <Chip tone={chip.tone}>{chip.label}</Chip>
          </div>
          {exam.titleAlt && (
            <p className="text-md text-body">
              <bdi>{exam.titleAlt}</bdi>
            </p>
          )}
          <p className="text-sm text-secondary">{examFacts(t, exam)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {exam.status !== "archived" && (
            <a href={webHref(`/exams/${exam.slug}`)} target="_blank" rel="noopener noreferrer" className={buttonClasses(small())}>
              {exam.status === "draft" ? "Try it on the member site" : "View on the member site"}
              <Icon name="external" size={14} />
            </a>
          )}
          {exam.status === "draft" && (
            <Button {...small("primary")} disabled={exam.questionCount === 0} title={exam.questionCount === 0 ? "Add at least one question first" : undefined} onClick={() => setConfirm("publish")}>
              Publish
            </Button>
          )}
          {exam.status === "published" && (
            <Button {...small()} onClick={() => setConfirm("unpublish")}>
              Unpublish
            </Button>
          )}
          {exam.status === "archived" ? (
            <Button {...small()} onClick={() => void setStatus("draft", t("“{title}” is a draft again.", { title: exam.title }))}>
              Restore as a draft
            </Button>
          ) : (
            <Button {...small("ghost")} onClick={() => setConfirm("archive")}>
              Archive
            </Button>
          )}
          <button type="button" onClick={() => setConfirm("delete")} className="rounded-md p-1.5 text-secondary hover:bg-error-light hover:text-error">
            <Icon name="x" size={16} label={t("Delete {name}", { name: exam.title })} />
          </button>
        </div>
      </div>

      {exam.status === "draft" && (
        <FormNotice tone="info">
          This exam is a draft: members can’t see it. You can take it yourself on the member site to check it; your own tries aren’t counted in the results.
        </FormNotice>
      )}
      {exam.status === "archived" && (
        <FormNotice tone="warning">This exam is archived: it is closed and off the Exams page. Members who took it can still see their results.</FormNotice>
      )}

      <SegmentedControl<Tab>
        label={t("Exam sections")}
        value={tab}
        onChange={setTab}
        className="self-start"
        items={[
          { value: "questions", label: `${t("Questions")} · ${exam.questionCount}` },
          { value: "settings", label: t("Settings") },
          { value: "invite", label: t("Invite") },
          { value: "results", label: `${t("Results")} · ${exam.stats.attempts}` },
        ]}
      />

      {tab === "questions" && <ExamQuestions exam={exam} taken={taken} onChange={setExam} />}
      {tab === "settings" && <ExamSettings exam={exam} onChange={setExam} />}
      {tab === "invite" && <ExamInvites exam={exam} />}
      {tab === "results" && <ExamResults exam={exam} onChange={setExam} />}

      {confirm === "publish" && (
        <ReasonDialog
          title="Publish this exam?"
          description={t("Members will find it under Exams and can start taking it straight away. It has {count} questions.", { count: exam.questionCount })}
          confirmLabel="Publish"
          reasonField="none"
          onClose={() => setConfirm(null)}
          onConfirm={() => setStatus("published", t("“{title}” is published.", { title: exam.title }))}
        />
      )}
      {confirm === "unpublish" && (
        <ReasonDialog
          title="Unpublish this exam?"
          description="It goes back to a draft and members no longer see it. Attempts already started can still be finished, and every result is kept."
          confirmLabel="Unpublish"
          reasonField="none"
          onClose={() => setConfirm(null)}
          onConfirm={() => setStatus("draft", t("“{title}” is a draft again.", { title: exam.title }))}
        />
      )}
      {confirm === "archive" && (
        <ReasonDialog
          title="Archive this exam?"
          description="It closes for members and leaves the Exams page. Results are kept, and members who took it can still see theirs. You can restore it later."
          confirmLabel="Archive"
          reasonField="none"
          onClose={() => setConfirm(null)}
          onConfirm={() => setStatus("archived", t("“{title}” is archived.", { title: exam.title }))}
        />
      )}
      {confirm === "delete" && (
        <ReasonDialog
          title="Delete this exam?"
          description="This deletes the exam and all its questions. It can’t be undone. An exam members have taken can’t be deleted: archive it instead."
          confirmLabel="Delete exam"
          tone="danger"
          reasonField="none"
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            await api(`/admin/exams/${exam.id}`, { method: "DELETE" });
            toast(t("“{title}” deleted.", { title: exam.title }));
            setConfirm(null);
            router.push("/exams");
            router.refresh();
          }}
        />
      )}
    </>
  );
}
