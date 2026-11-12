"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { EXAM_LANGUAGE_NAMES, ExamLanguage, type AdminExamDetail, type AdminExamSummary } from "@chartermission/contracts";
import { Button, Chip, Icon, buttonClasses } from "@chartermission/ui";
import { Field, FormModal, SelectBox } from "@/components/ambassadors/modal";
import { TextField } from "@/components/form-field";
import { EmptyState } from "@/components/states";
import { DateTime } from "@/components/time";
import { toast } from "@/components/toast";
import { ApiError, api, errorMessage } from "@/lib/api/client";
import { useT } from "@/i18n/client";
import { STATUS_CHIP, examFacts } from "./exam-labels";

export const LANGUAGE_OPTIONS = ExamLanguage.options.map((value) => ({ value, label: EXAM_LANGUAGE_NAMES[value] }));

/** Exams (GET /admin/exams): every exam with its status and results at a glance; create a new one. */
export function ExamsConsole({ initial }: { initial: AdminExamSummary[] }) {
  const t = useT();
  const [creating, setCreating] = useState(false);

  return (
    <section className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button size="small" onClick={() => setCreating(true)}>
          <Icon name="plus" size={16} />
          New exam
        </Button>
      </div>
      <div className="rounded-card border border-line bg-card">
        {initial.length === 0 ? (
          <EmptyState icon="clipboard" title="No exams yet">
            Create an exam, add its questions, then publish it for members.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {initial.map((exam) => {
              const chip = STATUS_CHIP[exam.status];
              return (
                <li key={exam.id} className="flex flex-wrap items-center gap-x-5 gap-y-3 px-5 py-4">
                  <div className="flex min-w-[260px] flex-1 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/exams/${exam.id}`} className="text-md font-medium text-ink hover:underline">
                        {exam.title}
                      </Link>
                      <Chip tone={chip.tone} className="px-2! py-0.5! text-xs!">
                        {chip.label}
                      </Chip>
                    </div>
                    {exam.titleAlt && (
                      <span className="text-sm text-secondary">
                        <bdi>{exam.titleAlt}</bdi>
                      </span>
                    )}
                    <span className="text-sm text-secondary">{examFacts(t, exam)}</span>
                  </div>
                  <div className="flex min-w-[180px] flex-col gap-0.5 text-sm">
                    <span className="text-body">
                      {exam.stats.participants > 0
                        ? t("{count} members took it · {passed} passed", { count: exam.stats.participants, passed: exam.stats.passedMembers })
                        : t("Not taken yet")}
                    </span>
                    <span className="text-xs text-secondary">
                      Updated <DateTime iso={exam.updatedAt} dateOnly />
                    </span>
                  </div>
                  <Link href={`/exams/${exam.id}`} className={buttonClasses({ variant: "secondary", size: "small" })}>
                    Open
                    <Icon name="chevron-right" size={16} className="rtl:rotate-180" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {creating && <NewExamForm onClose={() => setCreating(false)} />}
    </section>
  );
}

function NewExamForm({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  return (
    <FormModal
      title="New exam"
      description="The exam starts as a draft. Add its questions on the next screen, then publish it."
      submitLabel="Create exam"
      busy={busy}
      error={error}
      onClose={onClose}
      onSubmit={async (data) => {
        setBusy(true);
        setError(null);
        setFields({});
        const second = String(data.get("secondLanguage") ?? "");
        try {
          const exam = await api<AdminExamDetail>("/admin/exams", {
            method: "POST",
            body: { title: String(data.get("title") ?? "").trim(), language: String(data.get("language")), secondLanguage: second || null },
          });
          toast("Exam created. Add its questions next.");
          // Close first: an open modal left behind on the list would keep the next page inert.
          onClose();
          router.push(`/exams/${exam.id}`);
        } catch (e) {
          if (e instanceof ApiError && e.fields) setFields(e.fields);
          else setError(errorMessage(e));
          setBusy(false);
        }
      }}
    >
      <TextField label="Title" name="title" required maxLength={160} error={fields.title} placeholder="CAPM practice exam" />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Language">{(id) => <SelectBox id={id} name="language" defaultValue="en" options={LANGUAGE_OPTIONS} />}</Field>
        <Field label="Second language" error={fields.secondLanguage} hint="Write each question in two languages side by side; members choose which to read.">
          {(id, describedBy) => (
            <SelectBox id={id} name="secondLanguage" defaultValue="" describedBy={describedBy} invalid={!!fields.secondLanguage} options={[{ value: "", label: "None" }, ...LANGUAGE_OPTIONS]} />
          )}
        </Field>
      </div>
    </FormModal>
  );
}
