"use client";

import { useCallback, useEffect, useId, useState, type FormEvent } from "react";
import { EXAM_INVITES_PER_REQUEST, type AdminExamDetail, type ExamInviteRow, type ExamInviteStatus, type SendExamInvitesResult } from "@chartermission/contracts";
import { Button, Chip, Icon, type ChipTone } from "@chartermission/ui";
import { Field } from "@/components/ambassadors/modal";
import { FormNotice, inputClasses } from "@/components/form-field";
import { SkeletonTable } from "@/components/skeletons";
import { EmptyState, ErrorState } from "@/components/states";
import { DateTime } from "@/components/time";
import { toast } from "@/components/toast";
import { api, errorMessage } from "@/lib/api/client";
import { webHref } from "@/lib/navigation";
import { useT } from "@/i18n/client";

const STATUS: Record<ExamInviteStatus, { label: string; tone: ChipTone }> = {
  invited: { label: "Invited", tone: "neutral" },
  joined: { label: "Joined", tone: "info" },
  took: { label: "Took the exam", tone: "warning" },
  passed: { label: "Passed", tone: "success" },
};

/** Every address in pasted text (one per line, or separated by commas, semicolons or spaces). */
const addresses = (text: string) => [...new Set(text.split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean))];

/**
 * The Invite tab (POST/GET /admin/exams/:id/invites): email Charter Center students the exam's join
 * link, and follow who joined, took and passed it.
 */
export function ExamInvites({ exam }: { exam: AdminExamDetail }) {
  const t = useT();
  const ids = useId();
  const [text, setText] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<ExamInviteRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const link = webHref(`/exams/${exam.slug}/join`);
  const list = addresses(text);
  const published = exam.status === "published";

  const load = useCallback(async () => {
    try {
      setRows(await api<ExamInviteRow[]>(`/admin/exams/${exam.id}/invites`));
      setLoadError(null);
    } catch (e) {
      setLoadError(errorMessage(e));
    }
  }, [exam.id]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!list.length) return setError(t("Add at least one email address"));
    if (list.length > EXAM_INVITES_PER_REQUEST) return setError(t("Up to {count} addresses at a time", { count: EXAM_INVITES_PER_REQUEST }));
    setBusy(true);
    try {
      const r = await api<SendExamInvitesResult>(`/admin/exams/${exam.id}/invites`, { method: "POST", body: { emails: list, message: message.trim() || null } });
      const parts = [t("{count} invitations sent", { count: r.sent })];
      if (r.skipped) parts.push(t("{count} skipped (invited in the last 10 minutes)", { count: r.skipped }));
      if (r.invalid.length) parts.push(t("not email addresses: {list}", { list: r.invalid.join(", ") }));
      toast(parts.join(" · "), r.invalid.length ? "error" : "success");
      setText(r.invalid.join("\n"));
      void load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    await navigator.clipboard.writeText(link).catch(() => undefined);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  const counts = (rows ?? []).reduce<Record<ExamInviteStatus, number>>((acc, r) => ({ ...acc, [r.status]: acc[r.status] + 1 }), { invited: 0, joined: 0, took: 0, passed: 0 });

  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 rounded-card border border-line bg-card px-5 py-4">
        <h2 className="text-h3 text-ink">Join link for Charter Center students</h2>
        <p className="text-sm text-body">
          Students open it, enter the email of their Charter Center account and confirm it with a code. Their Charter Mission account is made from their Charter Center name and photo,
          and they go straight to this exam. Members who are already signed in go straight to the exam.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-md border border-line bg-muted px-3 py-2 text-sm text-ink" dir="ltr">
            {link}
          </code>
          <Button variant="secondary" size="small" onClick={() => void copy()}>
            <Icon name={copied ? "check" : "copy"} size={16} />
            {copied ? "Copied" : "Copy link"}
          </Button>
        </div>
        {!published && <FormNotice tone="warning">The link works once the exam is published.</FormNotice>}
      </div>

      <form noValidate onSubmit={send} className="flex flex-col gap-4 rounded-card border border-line bg-card px-5 py-4">
        <h2 className="text-h3 text-ink">Invite by email</h2>
        <Field label="Email addresses" hint={t("One per line, or separated by commas. Up to {count} at a time. Use the addresses students use on Charter Center.", { count: EXAM_INVITES_PER_REQUEST })}>
          {(id, describedBy) => (
            <textarea
              id={id}
              rows={5}
              dir="ltr"
              value={text}
              aria-describedby={describedBy}
              placeholder={"amina@example.com\nkofi@example.com"}
              onChange={(e) => setText(e.target.value)}
              className={inputClasses(false, "resize-y font-mono text-sm")}
            />
          )}
        </Field>
        <Field label="Message (optional)" hint="Added to the invitation email, e.g. a deadline.">
          {(id, describedBy) => (
            <textarea id={id} rows={2} maxLength={500} dir="auto" value={message} aria-describedby={describedBy} onChange={(e) => setMessage(e.target.value)} className={inputClasses(false, "resize-y")} />
          )}
        </Field>
        {error && <FormNotice tone="error">{error}</FormNotice>}
        <div className="flex flex-wrap items-center justify-end gap-3">
          <span className="text-sm text-secondary">{t("{count} addresses", { count: list.length })}</span>
          <Button type="submit" size="small" disabled={busy || !published || list.length === 0} aria-busy={busy}>
            {busy ? "Sending…" : "Send invitations"}
          </Button>
        </div>
      </form>

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id={`${ids}-sent`} className="text-h3 text-ink">
            Invited
          </h2>
          {rows && rows.length > 0 && (
            <p className="text-sm text-secondary">
              {t("{invited} not joined yet · {joined} joined · {took} took it · {passed} passed", counts)}
            </p>
          )}
        </div>
        {loadError ? (
          <div className="rounded-card border border-line bg-card">
            <ErrorState message={loadError} />
          </div>
        ) : rows === null ? (
          <SkeletonTable label="Loading invitations" rows={3} />
        ) : rows.length === 0 ? (
          <div className="rounded-card border border-line bg-card">
            <EmptyState icon="mail" title="No invitations yet">
              Invitations you send appear here, with who joined, took and passed the exam.
            </EmptyState>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-card border border-line bg-card">
            <table aria-labelledby={`${ids}-sent`} className="w-full min-w-[620px] border-collapse text-start">
              <thead className="bg-muted text-label text-secondary uppercase">
                <tr>
                  <th scope="col" className="py-3 ps-4 pe-3 text-start font-semibold">Email</th>
                  <th scope="col" className="w-[150px] py-3 pe-3 text-start font-semibold">Status</th>
                  <th scope="col" className="w-[90px] py-3 pe-3 text-start font-semibold">Emails</th>
                  <th scope="col" className="w-[170px] py-3 pe-4 text-start font-semibold">Last sent</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => (
                  <tr key={r.email} className="text-sm text-body">
                    <td className="py-3 ps-4 pe-3 font-medium text-ink" dir="ltr">
                      {r.email}
                    </td>
                    <td className="py-3 pe-3">
                      <Chip tone={STATUS[r.status].tone} className="px-2! py-0.5! text-xs!">
                        {STATUS[r.status].label}
                      </Chip>
                    </td>
                    <td className="py-3 pe-3 tabular-nums">{r.sends}</td>
                    <td className="py-3 pe-4">
                      <DateTime iso={r.lastSentAt} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
