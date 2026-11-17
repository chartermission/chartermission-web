"use client";

import { useState } from "react";
import type { ExamInstructor, ExamInstructorSaved } from "@chartermission/contracts";
import { Button, Chip, Icon, cn } from "@chartermission/ui";
import { FormModal } from "@/components/ambassadors/modal";
import { FormNotice, TextField } from "@/components/form-field";
import { ReasonDialog } from "@/components/reason-dialog";
import { EmptyState } from "@/components/states";
import { toast } from "@/components/toast";
import { ApiError, api, errorMessage } from "@/lib/api/client";
import { useT } from "@/i18n/client";
import { SignaturePreview, SignatureField } from "./signature-field";

/** Active instructors first, then by name (as the API lists them). */
export const sortInstructors = (items: ExamInstructor[]) =>
  [...items].sort((a, b) => Number(a.archived) - Number(b.archived) || a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

/**
 * Add or edit an instructor (POST /admin/exam-instructors, PATCH /admin/exam-instructors/:id).
 * Editing one used by exams warns first: those exams' new certificates change, and the ones
 * already issued become outdated. Mount it only while it should be open.
 */
export function InstructorDialog({
  instructor,
  onSaved,
  onClose,
}: {
  /** The one to edit; leave out to add one. */
  instructor?: ExamInstructor | null;
  onSaved: (saved: ExamInstructor, affectedExams: number) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [name, setName] = useState(instructor?.name ?? "");
  const [signatureFileId, setSignatureFileId] = useState(instructor?.signatureFileId ?? "");
  const [preview, setPreview] = useState<string | null>(instructor?.signatureUrl ?? null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const changed = !instructor || name.trim() !== instructor.name || signatureFileId !== instructor.signatureFileId;
  const usedBy = instructor?.examCount ?? 0;

  async function submit() {
    const errors: Record<string, string> = {};
    if (name.trim().length < 2) errors.name = t("Write the instructor’s name");
    if (!signatureFileId) errors.signatureFileId = t("Upload the instructor’s signature");
    setFields(errors);
    setError(null);
    if (Object.keys(errors).length) return;
    if (instructor && !changed) return onClose();
    setBusy(true);
    try {
      if (instructor) {
        const body: { name?: string; signatureFileId?: string } = {};
        if (name.trim() !== instructor.name) body.name = name.trim();
        if (signatureFileId !== instructor.signatureFileId) body.signatureFileId = signatureFileId;
        const saved = await api<ExamInstructorSaved>(`/admin/exam-instructors/${instructor.id}`, { method: "PATCH", body });
        const { affectedExams, ...view } = saved;
        onSaved(view, affectedExams);
      } else {
        onSaved(await api<ExamInstructor>("/admin/exam-instructors", { method: "POST", body: { name: name.trim(), signatureFileId } }), 0);
      }
    } catch (e) {
      if (e instanceof ApiError && e.fields) setFields(e.fields);
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <FormModal
      title={instructor ? t("Edit {name}", { name: instructor.name }) : t("New instructor")}
      description="The name and signature printed on Charter Center certificates."
      submitLabel={instructor ? "Save instructor" : "Add instructor"}
      busy={busy}
      error={error}
      onSubmit={() => void submit()}
      onClose={onClose}
    >
      <TextField
        label="Name"
        value={name}
        maxLength={120}
        dir="auto"
        placeholder="Eng. Abdalla Yousif"
        hint="Printed under the signature."
        error={fields.name}
        onChange={(e) => setName(e.target.value)}
      />
      <SignatureField
        preview={preview}
        error={fields.signatureFileId}
        onUploaded={(id, url) => {
          setSignatureFileId(id);
          setPreview(url);
          setFields((prev) => {
            const next = { ...prev };
            delete next.signatureFileId;
            return next;
          });
        }}
      />
      {instructor && usedBy > 0 && changed && (
        <FormNotice tone="warning">
          {t("Used by {count} exams. New certificates for them use the new name and signature; certificates already issued are marked as outdated, so you can replace them.", {
            count: usedBy,
          })}
        </FormNotice>
      )}
    </FormModal>
  );
}

/** Instructors (GET /admin/exam-instructors): who signs Charter Center certificates, shared by exams. */
export function InstructorsConsole({ initial }: { initial: ExamInstructor[] }) {
  const t = useT();
  const [items, setItems] = useState(() => sortInstructors(initial));
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<ExamInstructor | "new" | null>(null);
  const [deleting, setDeleting] = useState<ExamInstructor | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const put = (row: ExamInstructor) => setItems((list) => sortInstructors([...list.filter((i) => i.id !== row.id), row]));
  const archivedCount = items.filter((i) => i.archived).length;
  const shown = showArchived ? items : items.filter((i) => !i.archived);

  async function setArchived(row: ExamInstructor, archived: boolean) {
    setBusyId(row.id);
    try {
      put(await api<ExamInstructor>(`/admin/exam-instructors/${row.id}/${archived ? "archive" : "restore"}`, { method: "POST" }));
      toast(
        archived
          ? t("{name} archived. Exams that use them keep them; they’re no longer offered for other exams.", { name: row.name })
          : t("{name} restored.", { name: row.name }),
      );
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {archivedCount > 0 ? (
          <label className="flex cursor-pointer items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} className="size-4 accent-primary" />
            {t("Show archived ({count})", { count: archivedCount })}
          </label>
        ) : (
          <span />
        )}
        <Button size="small" onClick={() => setEditing("new")}>
          <Icon name="plus" size={16} />
          New instructor
        </Button>
      </div>

      <div className="rounded-card border border-line bg-card">
        {shown.length === 0 ? (
          <EmptyState icon="edit" title="No instructors yet">
            Add the people who sign Charter Center certificates. Each exam that awards a certificate names one of them.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {shown.map((row) => {
              const busy = busyId === row.id;
              return (
                <li key={row.id} className={cn("flex flex-wrap items-center gap-x-5 gap-y-3 px-5 py-4", row.archived && "bg-muted/40")}>
                  <SignaturePreview url={row.signatureUrl} alt={t("Signature of {name}", { name: row.name })} small />
                  <div className="flex min-w-[220px] flex-1 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-md font-medium text-ink">
                        <bdi>{row.name}</bdi>
                      </span>
                      {row.archived && (
                        <Chip tone="neutral" className="px-2! py-0.5! text-xs!">
                          Archived
                        </Chip>
                      )}
                    </div>
                    <span className="text-sm text-secondary">
                      {row.examCount > 0 ? t("Used by {count} exams", { count: row.examCount }) : t("Not used by any exam")}
                    </span>
                  </div>
                  <div className="flex flex-wrap justify-end gap-1">
                    <Button variant="ghost" size="small" disabled={busy} onClick={() => setEditing(row)}>
                      Edit
                    </Button>
                    <Button variant="ghost" size="small" disabled={busy} onClick={() => void setArchived(row, !row.archived)}>
                      {row.archived ? "Restore" : "Archive"}
                    </Button>
                    {row.examCount === 0 && (
                      <Button variant="ghost" size="small" disabled={busy} onClick={() => setDeleting(row)}>
                        Delete
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {editing && (
        <InstructorDialog
          instructor={editing === "new" ? null : editing}
          onSaved={(saved, affectedExams) => {
            put(saved);
            setEditing(null);
            toast(
              editing === "new"
                ? t("{name} added.", { name: saved.name })
                : affectedExams > 0
                  ? t("Saved. Certificates already issued for {count} exams are now outdated: replace them from each exam’s Certificates tab.", { count: affectedExams })
                  : t("Saved."),
            );
          }}
          onClose={() => setEditing(null)}
        />
      )}
      {deleting && (
        <ReasonDialog
          title={t("Delete {name}?", { name: deleting.name })}
          description="No exam uses this instructor. Deleting can’t be undone; to keep them for later, archive them instead."
          confirmLabel="Delete"
          tone="danger"
          reasonField="none"
          onConfirm={async () => {
            await api(`/admin/exam-instructors/${deleting.id}`, { method: "DELETE" });
            setItems((list) => list.filter((i) => i.id !== deleting.id));
            toast(t("{name} deleted.", { name: deleting.name }));
            setDeleting(null);
          }}
          onClose={() => setDeleting(null)}
        />
      )}
    </section>
  );
}
