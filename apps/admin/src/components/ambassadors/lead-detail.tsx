"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import {
  LEAD_INTERVIEW_THRESHOLD,
  LEAD_RUBRIC,
  LEAD_SOURCE_LABELS,
  LEAD_STAGE_HINTS,
  LEAD_STAGE_LABELS,
  LEAD_TALENT_POOL_THRESHOLD,
  type AdminLeadDetail,
  type AmbassadorStepKey,
  type AmbassadorStepStatus,
  type CountryRef,
  type LeadScores,
  type LeadStage,
  type TeamMember,
} from "@chartermission/contracts";
import { Button, Chip, Icon, buttonClasses, cn } from "@chartermission/ui";
import { FormNotice, inputClasses } from "@/components/form-field";
import { DialogSelect, ReasonDialog } from "@/components/reason-dialog";
import { Age, DateTime } from "@/components/time";
import { toast } from "@/components/toast";
import { api, errorMessage, isApiError } from "@/lib/api/client";
import { webHref } from "@/lib/navigation";
import { MOVABLE_STAGES, STAGE_TONE } from "@/lib/ambassadors";
import { LeadFields, leadInputFromForm } from "./lead-fields";
import { Progress } from "./leads-workspace";

type Dialog = "stage" | "certify" | "end" | null;

/** One lead: pipeline actions, onboarding checklist, rubric, details and activity. */
export function LeadDetailView({ initial, team, countries }: { initial: AdminLeadDetail; team: TeamMember[]; countries: CountryRef[] }) {
  const [lead, setLead] = useState(initial);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const base = `/admin/ambassadors/leads/${lead.id}`;

  /** Run a mutation that returns the updated lead; report errors as toasts. */
  async function run(key: string, call: () => Promise<AdminLeadDetail>, done?: string) {
    setBusy(key);
    try {
      setLead(await call());
      if (done) toast(done);
      return true;
    } catch (e) {
      toast(errorMessage(e), "error");
      return false;
    } finally {
      setBusy(null);
    }
  }

  const closed = lead.stage === "ambassador";
  const checklist = lead.checklist;

  return (
    <div className="flex flex-col gap-5">
      <Link href="/ambassadors" className="inline-flex w-fit items-center gap-1 text-sm text-secondary hover:text-ink">
        <Icon name="chevron-left" size={16} />
        All leads
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-4 rounded-card border border-line bg-card p-5">
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-h2 text-ink">{lead.fullName}</h1>
            <Chip tone={STAGE_TONE[lead.stage]} className="px-2.5! py-0.5! text-xs!">
              {LEAD_STAGE_LABELS[lead.stage]}
            </Chip>
            {lead.founding && closed && <Chip tone="warning" className="px-2.5! py-0.5! text-xs!">Founding</Chip>}
          </div>
          <p className="text-sm text-body">
            {[lead.jobTitle, lead.organisation].filter(Boolean).join(", ") || "No role recorded"} · {lead.city ? `${lead.city}, ` : ""}
            {lead.country.name}
          </p>
          <p className="text-xs text-secondary">
            {LEAD_STAGE_HINTS[lead.stage]} In this stage for <Age iso={lead.stageChangedAt} />.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!closed && (
            <Button variant="secondary" size="small" disabled={!!busy} onClick={() => setDialog("stage")}>
              Move stage
            </Button>
          )}
          {closed && (
            <Button variant="secondary" size="small" disabled={!!busy} onClick={() => setDialog("end")}>
              End term
            </Button>
          )}
          {lead.stage === "onboarding" && (
            <Button size="small" disabled={!!busy || !checklist?.readyToCertify} onClick={() => setDialog("certify")}>
              <Icon name="verified" size={16} />
              Certify as Ambassador
            </Button>
          )}
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex flex-col gap-5">
          {checklist && (
            <Section
              title="Onboarding"
              aside={<Progress done={checklist.steps.filter((s) => s.status !== "pending").length} total={checklist.steps.length} />}
            >
              <Checklist lead={lead} busy={busy} run={run} base={base} />
            </Section>
          )}
          {!checklist && !["declined", "withdrawn", "talent_pool"].includes(lead.stage) && (
            <FormNotice tone="info">
              Onboarding starts when you move this lead to <strong>Onboarding</strong>. They get an email with the steps and the training courses.
            </FormNotice>
          )}
          <Section title="Qualification scores" aside={<ScoreTotal total={lead.scoreTotal} />}>
            <Scores lead={lead} disabled={closed} onSave={(scores) => run("scores", () => api<AdminLeadDetail>(base, { method: "PATCH", body: { scores } }), "Scores saved")} />
          </Section>
          <Section title="Details">
            <Details lead={lead} team={team} countries={countries} onSaved={setLead} />
          </Section>
        </div>

        <aside className="flex flex-col gap-5">
          <Section title="At a glance">
            <dl className="grid grid-cols-[110px_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
              <Row label="Email">
                <a href={`mailto:${lead.email}`} className="break-all text-primary hover:underline">
                  {lead.email}
                </a>
              </Row>
              {lead.phone && <Row label="Phone">{lead.phone}</Row>}
              <Row label="Owner">{lead.owner?.name ?? "Unassigned"}</Row>
              <Row label="Source">
                {LEAD_SOURCE_LABELS[lead.source]}
                {lead.referredBy ? ` (${lead.referredBy})` : ""}
              </Row>
              <Row label="Member account">
                {lead.member ? (
                  <a href={webHref(`/members/${lead.member.handle}`)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                    @{lead.member.handle} <Icon name="external" size={12} />
                  </a>
                ) : (
                  <span className="text-secondary">None with this email yet</span>
                )}
              </Row>
              <Row label="Chapter">{lead.chapter?.name ?? <span className="text-secondary">No chapter yet for {lead.country.name}</span>}</Row>
              {lead.linkedinUrl && (
                <Row label="LinkedIn">
                  <a href={lead.linkedinUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                    Profile <Icon name="external" size={12} />
                  </a>
                </Row>
              )}
              {lead.certifiedAt && (
                <Row label="Certified">
                  <DateTime iso={lead.certifiedAt} dateOnly />
                </Row>
              )}
              <Row label="Added">
                <DateTime iso={lead.createdAt} dateOnly />
                {lead.createdBy ? ` by ${lead.createdBy.name}` : ""}
              </Row>
            </dl>
          </Section>
          <Section title="Activity">
            <Activity lead={lead} onNote={(body) => run("note", () => api<AdminLeadDetail>(`${base}/notes`, { body: { body } }), "Note added")} busy={busy === "note"} />
          </Section>
        </aside>
      </div>

      {dialog === "stage" && (
        <ReasonDialog
          title="Move this lead"
          description={`${lead.fullName} is in ${LEAD_STAGE_LABELS[lead.stage]}. Moving to Onboarding sends them the onboarding email.`}
          confirmLabel="Move"
          reasonField="optional"
          reasonLabel="Note"
          reasonPlaceholder="Why, or what happens next (shown in the activity)"
          minReasonLength={1}
          reasonHint="Recorded in the lead’s activity and the audit log."
          onConfirm={async (note, data) => {
            const stage = String(data.get("stage")) as LeadStage;
            const ok = await run("stage", () => api<AdminLeadDetail>(`${base}/stage`, { body: { stage, note: note || undefined } }), `Moved to ${LEAD_STAGE_LABELS[stage]}`);
            if (ok) setDialog(null);
          }}
          onClose={() => setDialog(null)}
        >
          <DialogSelect
            label="New stage"
            name="stage"
            defaultValue={nextStage(lead.stage)}
            options={MOVABLE_STAGES.filter((s) => s !== lead.stage).map((s) => ({ value: s, label: LEAD_STAGE_LABELS[s] }))}
          />
        </ReasonDialog>
      )}
      {dialog === "end" && (
        <ReasonDialog
          title={`End ${lead.fullName}’s term?`}
          description="The Ambassador badge comes off their profile straight away. In good standing they keep a grey Alumni Ambassador badge."
          confirmLabel="End term"
          tone="danger"
          reasonField="optional"
          reasonLabel="Note"
          minReasonLength={1}
          reasonPlaceholder="Why the term is ending"
          reasonHint="Recorded in the lead’s activity and the audit log."
          onConfirm={async (note, data) => {
            const outcome = String(data.get("outcome")) === "removed" ? "removed" : "alumni";
            const ok = await run("end", () => api<AdminLeadDetail>(`${base}/end-term`, { body: { outcome, note: note || undefined } }), outcome === "alumni" ? "Term ended. They are now an Alumni Ambassador." : "Removed as Ambassador");
            if (ok) setDialog(null);
          }}
          onClose={() => setDialog(null)}
        >
          <DialogSelect
            label="Outcome"
            name="outcome"
            defaultValue="alumni"
            options={[
              { value: "alumni", label: "Term ended in good standing (Alumni badge)" },
              { value: "removed", label: "Removed (no badge)" },
            ]}
          />
        </ReasonDialog>
      )}
      {dialog === "certify" && (
        <ReasonDialog
          title={`Certify ${lead.fullName}?`}
          description={
            <>
              They become the Ambassador for <strong>{lead.chapter?.name ?? lead.country.name}</strong>. The Ambassador badge appears on their profile at once, and they get a confirmation email.
            </>
          }
          confirmLabel="Certify"
          reasonField="optional"
          reasonLabel="Note"
          minReasonLength={1}
          reasonPlaceholder="Anything the team should know"
          reasonHint="Recorded in the lead’s activity and the audit log."
          onConfirm={async (note, data) => {
            const founding = data.get("founding") === "on";
            const ok = await run("certify", () => api<AdminLeadDetail>(`${base}/certify`, { body: { founding, note: note || undefined } }), "Certified. The badge is live.");
            if (ok) setDialog(null);
          }}
          onClose={() => setDialog(null)}
        >
          <label className="flex items-start gap-2 text-sm text-body">
            <input type="checkbox" name="founding" className="mt-0.5 size-4 accent-primary" />
            <span>
              <span className="font-medium text-ink">Founding Ambassador</span>
              <span className="block text-xs text-secondary">For the first intake: the badge reads “Founding Ambassador”.</span>
            </span>
          </label>
        </ReasonDialog>
      )}
    </div>
  );
}

function nextStage(stage: LeadStage): LeadStage {
  const order: LeadStage[] = ["new", "screening", "review", "interview", "references", "decision", "onboarding"];
  const i = order.indexOf(stage);
  return i >= 0 && i < order.length - 1 ? order[i + 1]! : "screening";
}

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-card border border-line bg-card">
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
        <h2 className="text-md font-semibold text-ink">{title}</h2>
        {aside}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-secondary">{label}</dt>
      <dd className="min-w-0 text-ink">{children}</dd>
    </>
  );
}

/* ----------------------------- Onboarding ----------------------------- */

const STEP_ICON: Record<AmbassadorStepStatus, { icon: "check" | "clock" | "x"; className: string; label: string }> = {
  done: { icon: "check", className: "bg-success text-inverse", label: "Done" },
  waived: { icon: "x", className: "bg-muted text-secondary", label: "Waived" },
  pending: { icon: "clock", className: "bg-warning-light text-warning", label: "To do" },
};

function Checklist({
  lead,
  busy,
  run,
  base,
}: {
  lead: AdminLeadDetail;
  busy: string | null;
  run: (key: string, call: () => Promise<AdminLeadDetail>, done?: string) => Promise<boolean>;
  base: string;
}) {
  const checklist = lead.checklist!;
  const locked = lead.stage !== "onboarding";
  const setStep = (key: AmbassadorStepKey, status: AmbassadorStepStatus) =>
    run(`step:${key}`, () => api<AdminLeadDetail>(`${base}/onboarding/${key}`, { method: "PATCH", body: { status } }));
  const setCourse = (courseId: string, completed: boolean) =>
    run(`course:${courseId}`, () => api<AdminLeadDetail>(`${base}/training/${courseId}`, { method: "PUT", body: { completed } }));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-secondary">
        <span>
          Started <DateTime iso={checklist.startedAt} dateOnly />
          {checklist.invitedAt ? (
            <>
              {" "}
              · onboarding email sent <Age iso={checklist.invitedAt} /> ago
            </>
          ) : (
            " · onboarding email not sent"
          )}
        </span>
        {!locked && (
          <Button variant="ghost" size="small" disabled={!!busy} onClick={() => run("invite", () => api<AdminLeadDetail>(`${base}/invite`, { method: "POST" }), "Onboarding email sent")}>
            <Icon name="mail" size={14} />
            Resend email
          </Button>
        )}
      </div>
      <ol className="flex flex-col divide-y divide-line">
        {checklist.steps.map((step) => {
          const s = STEP_ICON[step.status];
          const auto = step.key === "account" || (step.key === "training" && checklist.training.length > 0);
          return (
            <li key={step.key} className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0">
              <div className="flex items-start gap-3">
                <span className={cn("mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full", s.className)} title={s.label}>
                  <Icon name={s.icon} size={14} label={s.label} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className={cn("text-sm font-medium", step.status === "waived" ? "text-secondary line-through" : "text-ink")}>{step.label}</p>
                  <p className="text-xs text-secondary">{step.description}</p>
                  {step.completedAt && (
                    <p className="mt-0.5 text-xs text-secondary">
                      {step.status === "waived" ? "Waived" : "Done"} <DateTime iso={step.completedAt} dateOnly />
                      {step.completedBy ? ` by ${step.completedBy.name}` : ""}
                      {step.note ? ` · ${step.note}` : ""}
                    </p>
                  )}
                </div>
                {!locked && (
                  <div className="flex shrink-0 gap-1">
                    {step.status === "pending" ? (
                      <>
                        {!auto && (
                          <Button size="small" variant="secondary" disabled={!!busy} onClick={() => setStep(step.key, "done")}>
                            Mark done
                          </Button>
                        )}
                        {step.key === "account" && (
                          <Button size="small" variant="secondary" disabled={!!busy} onClick={() => setStep(step.key, "done")} title="Checks for an account with this email">
                            Check again
                          </Button>
                        )}
                        <Button size="small" variant="ghost" disabled={!!busy} onClick={() => setStep(step.key, "waived")}>
                          Waive
                        </Button>
                      </>
                    ) : (
                      <Button size="small" variant="ghost" disabled={!!busy} onClick={() => setStep(step.key, "pending")}>
                        Reopen
                      </Button>
                    )}
                  </div>
                )}
              </div>
              {step.key === "training" && checklist.training.length > 0 && (
                <ul className="ml-9 flex flex-col gap-2 rounded-lg bg-muted/60 p-3">
                  {checklist.training.map((c) => (
                    <li key={c.courseId} className="flex items-center gap-3 text-sm">
                      <input
                        type="checkbox"
                        checked={!!c.completedAt}
                        disabled={locked || !!busy}
                        onChange={(e) => void setCourse(c.courseId, e.target.checked)}
                        aria-label={`${c.title} completed`}
                        className="size-4 accent-primary"
                      />
                      <a href={c.startUrl} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate text-ink hover:text-primary hover:underline">
                        {c.title}
                      </a>
                      <span className="shrink-0 text-xs text-secondary">{c.completedAt ? <DateTime iso={c.completedAt} dateOnly /> : "Not yet"}</span>
                    </li>
                  ))}
                  <li className="text-xs text-secondary">Charter Center doesn’t report completions to us, so tick each course when they share their certificate.</li>
                </ul>
              )}
            </li>
          );
        })}
      </ol>
      {lead.stage === "onboarding" && !checklist.readyToCertify && (
        <p className="text-xs text-secondary">
          {lead.member ? "Finish or waive every step to certify." : "They need a member account with this email, and every step finished or waived, before you can certify."}
        </p>
      )}
    </div>
  );
}

/* ----------------------------- Scores ----------------------------- */

function ScoreTotal({ total }: { total: number | null }) {
  if (total === null) return <span className="text-xs text-secondary">Not scored</span>;
  const tone = total >= LEAD_INTERVIEW_THRESHOLD ? "success" : total >= LEAD_TALENT_POOL_THRESHOLD ? "warning" : "error";
  return (
    <Chip tone={tone} className="px-2.5! py-0.5! text-xs! tabular-nums">
      {total}/100
    </Chip>
  );
}

function Scores({ lead, disabled, onSave }: { lead: AdminLeadDetail; disabled: boolean; onSave: (scores: LeadScores) => Promise<boolean> }) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(LEAD_RUBRIC.map((r) => [r.key, lead.scores[r.key] == null ? "" : String(lead.scores[r.key])])),
  );
  const [saving, setSaving] = useState(false);
  const parsed = LEAD_RUBRIC.map((r) => {
    const raw = values[r.key] ?? "";
    const n = raw === "" ? null : Number(raw);
    return { ...r, n, invalid: n !== null && (!Number.isInteger(n) || n < 0 || n > r.max) };
  });
  const total = parsed.reduce((a, r) => a + (r.n ?? 0), 0);
  const invalid = parsed.some((r) => r.invalid);
  const dirty = parsed.some((r) => (lead.scores[r.key] ?? null) !== r.n);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (invalid) return;
    setSaving(true);
    await onSave(Object.fromEntries(parsed.map((r) => [r.key, r.n])) as LeadScores);
    setSaving(false);
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-4">
      <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        {parsed.map((r) => (
          <label key={r.key} className="flex items-center justify-between gap-3 text-sm">
            <span className="text-body">{r.label}</span>
            <span className="flex items-center gap-1.5">
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={r.max}
                step={1}
                disabled={disabled}
                value={values[r.key]}
                onChange={(e) => setValues((v) => ({ ...v, [r.key]: e.target.value }))}
                aria-invalid={r.invalid || undefined}
                className={inputClasses(r.invalid, "w-16 text-right tabular-nums")}
              />
              <span className="w-8 text-xs text-secondary">/ {r.max}</span>
            </span>
          </label>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
        <p className="text-xs text-secondary">
          Total {total}/100. {LEAD_INTERVIEW_THRESHOLD}+ goes to interview, {LEAD_TALENT_POOL_THRESHOLD}–{LEAD_INTERVIEW_THRESHOLD - 1} to the talent pool.
        </p>
        {!disabled && (
          <button type="submit" disabled={!dirty || invalid || saving} className={buttonClasses({ variant: "primary", size: "small" })}>
            {saving ? "Saving…" : "Save scores"}
          </button>
        )}
      </div>
    </form>
  );
}

/* ----------------------------- Details ----------------------------- */

function Details({ lead, team, countries, onSaved }: { lead: AdminLeadDetail; team: TeamMember[]; countries: CountryRef[]; onSaved: (lead: AdminLeadDetail) => void }) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFields({});
    try {
      onSaved(await api<AdminLeadDetail>(`/admin/ambassadors/leads/${lead.id}`, { method: "PATCH", body: leadInputFromForm(new FormData(event.currentTarget), "edit") }));
      toast("Details saved");
      setEditing(false);
    } catch (e) {
      if (isApiError(e) && e.fields) setFields(e.fields);
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 text-sm sm:grid-cols-2">
          <Prose label="Motivation and vision" text={lead.motivation} />
          <Prose label="Internal notes" text={lead.notes} />
          <Prose label="Hours per week" text={lead.hoursPerWeek === null ? null : String(lead.hoursPerWeek)} />
        </div>
        <div>
          <Button variant="secondary" size="small" onClick={() => setEditing(true)}>
            Edit details
          </Button>
        </div>
      </div>
    );
  }
  return (
    <form noValidate onSubmit={save} className="flex flex-col gap-4">
      <LeadFields lead={lead} countries={countries} team={team} errors={fields} />
      {error && <FormNotice tone="error">{error}</FormNotice>}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" size="small" disabled={busy} onClick={() => setEditing(false)}>
          Cancel
        </Button>
        <button type="submit" disabled={busy} className={buttonClasses({ variant: "primary", size: "small" })}>
          {busy ? "Saving…" : "Save details"}
        </button>
      </div>
    </form>
  );
}

function Prose({ label, text }: { label: string; text: string | null }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs font-medium text-secondary">{label}</p>
      <p className="whitespace-pre-line text-ink">{text || <span className="text-secondary">Not recorded</span>}</p>
    </div>
  );
}

/* ----------------------------- Activity ----------------------------- */

function Activity({ lead, onNote, busy }: { lead: AdminLeadDetail; onNote: (body: string) => Promise<boolean>; busy: boolean }) {
  const [note, setNote] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!note.trim()) return;
    if (await onNote(note.trim())) setNote("");
  }
  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={submit} className="flex flex-col gap-2">
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          maxLength={3000}
          placeholder="Add a note: a call, a reference, a next step"
          aria-label="New note"
          className={inputClasses(false, "resize-y")}
        />
        <button type="submit" disabled={busy || !note.trim()} className={cn(buttonClasses({ variant: "secondary", size: "small" }), "self-end")}>
          {busy ? "Adding…" : "Add note"}
        </button>
      </form>
      <ol className="flex flex-col gap-3">
        {lead.activity.map((a) => (
          <li key={a.id} className="flex flex-col gap-0.5 border-l-2 border-line pl-3">
            <p className={cn("text-sm whitespace-pre-line", a.kind === "note" ? "text-ink" : "text-body")}>{a.body}</p>
            <p className="text-xs text-secondary">
              {a.actor?.name ?? "System"} · <DateTime iso={a.createdAt} />
            </p>
          </li>
        ))}
      </ol>
    </div>
  );
}
