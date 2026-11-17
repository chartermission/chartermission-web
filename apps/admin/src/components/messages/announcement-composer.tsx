"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AnnouncementInput,
  type AnnouncementAudience,
  type AnnouncementAudienceCount,
  type AnnouncementSendResult,
  type AnnouncementView,
  type MessagingSettingsView,
} from "@chartermission/contracts";
import { Avatar, Button, Icon, cn } from "@chartermission/ui";
import { FormNotice, TextField, inputClasses } from "@/components/form-field";
import { ReasonDialog } from "@/components/reason-dialog";
import { PageHeader } from "@/components/shell/page-header";
import { toast } from "@/components/toast";
import { ApiError, api, errorMessage } from "@/lib/api/client";
import { channelsText, cleanAudience, type AudienceOptions } from "@/lib/messages";
import { useT } from "@/i18n/client";
import { AnnouncementPreview } from "./announcement-preview";
import { AudienceFilters } from "./audience-filters";

const SUBJECT_MAX = 150;
const BODY_MAX = 5000;
const LABEL_MAX = 40;
const COUNT_DEBOUNCE_MS = 400;

type Channels = { email: boolean; message: boolean; notification: boolean };
type Form = {
  subject: string;
  body: string;
  linkUrl: string;
  linkLabel: string;
  channels: Channels;
  important: boolean;
  audience: AnnouncementAudience;
};
type Errors = Partial<Record<"subject" | "body" | "linkUrl" | "linkLabel" | "channels" | "joinedTo" | "form", string>>;
type Busy = null | "save" | "test" | "send" | "delete";

function formOf(view: AnnouncementView | null): Form {
  return {
    subject: view?.subject ?? "",
    body: view?.body ?? "",
    linkUrl: view?.linkUrl ?? "",
    linkLabel: view?.linkLabel ?? "",
    channels: view?.channels ?? { email: true, message: true, notification: false },
    important: view?.important ?? false,
    audience: view?.audience ?? {},
  };
}

function inputOf(form: Form) {
  const linkUrl = form.linkUrl.trim();
  const linkLabel = form.linkLabel.trim();
  return {
    subject: form.subject,
    body: form.body,
    linkUrl: linkUrl || null,
    linkLabel: linkUrl && linkLabel ? linkLabel : null,
    channels: form.channels,
    audience: cleanAudience(form.audience),
    important: form.important,
  };
}

/** Field messages from the contract's checks (or the API's `fields`), keyed by the form's fields. */
function errorsFrom(paths: [string, string][]): Errors {
  const out: Errors = {};
  for (const [path, message] of paths) {
    const key =
      path === "subject" || path === "body" || path === "linkUrl" || path === "linkLabel"
        ? path
        : path.startsWith("channels")
          ? "channels"
          : path.startsWith("audience")
            ? path.endsWith("joinedTo") || path.endsWith("joinedFrom")
              ? "joinedTo"
              : "form"
            : "form";
    if (!out[key]) out[key] = message;
  }
  return out;
}

/**
 * Write a bulk message (POST /admin/announcements) or edit a draft (PATCH), choose who gets it, see
 * how many members that is (POST /admin/announcements/audience, as the filters change) and how it
 * looks, send a test to yourself, then send it.
 */
export function AnnouncementComposer({
  initial,
  options,
  settings,
  viewerEmail,
}: {
  initial: AnnouncementView | null;
  options: AudienceOptions;
  settings: MessagingSettingsView | null;
  viewerEmail: string;
}) {
  const t = useT();
  const router = useRouter();
  const ids = useId();
  const [id, setId] = useState<string | null>(initial?.id ?? null);
  const [form, setForm] = useState<Form>(() => formOf(initial));
  const [saved, setSaved] = useState(() => JSON.stringify(inputOf(formOf(initial))));
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState<Busy>(null);
  const [confirm, setConfirm] = useState<null | { kind: "send"; count: AnnouncementAudienceCount } | { kind: "delete" }>(null);
  const [count, setCount] = useState<AnnouncementAudienceCount | null>(null);
  const [counting, setCounting] = useState(false);
  const [countError, setCountError] = useState<string | null>(null);
  const countRequest = useRef(0);
  const root = useRef<HTMLDivElement>(null);

  const input = useMemo(() => inputOf(form), [form]);
  const dirty = JSON.stringify(input) !== saved;
  const sender = settings?.sender ?? null;
  const noSender = form.channels.message && settings !== null && !settings.senderId;
  const joinedBad = !!input.audience.joinedFrom && !!input.audience.joinedTo && input.audience.joinedTo < input.audience.joinedFrom;
  const audienceKey = JSON.stringify({ audience: input.audience, important: input.important });

  // Ask how many members the filter reaches a moment after it stops changing.
  useEffect(() => {
    if (joinedBad) return;
    const mine = ++countRequest.current;
    const timer = window.setTimeout(async () => {
      setCounting(true);
      try {
        const result = await api<AnnouncementAudienceCount>("/admin/announcements/audience", { method: "POST", body: JSON.parse(audienceKey) });
        if (mine !== countRequest.current) return;
        setCount(result);
        setCountError(null);
      } catch (e) {
        if (mine !== countRequest.current) return;
        setCountError(errorMessage(e));
      } finally {
        if (mine === countRequest.current) setCounting(false);
      }
    }, COUNT_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [audienceKey, joinedBad]);

  // Unsaved changes: the browser asks before leaving the page.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const update = <K extends keyof Form>(key: K, value: Form[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    const errorKey = key === "audience" ? "joinedTo" : key === "important" ? null : key;
    if (errorKey && errors[errorKey as keyof Errors]) setErrors((e) => ({ ...e, [errorKey]: undefined }));
  };

  function validate(): boolean {
    const parsed = AnnouncementInput.safeParse(input);
    if (parsed.success) {
      setErrors({});
      return true;
    }
    const next = errorsFrom(parsed.error.issues.map((i) => [i.path.join("."), t(i.message)]));
    setErrors(next);
    const first = (["subject", "body", "linkUrl", "linkLabel", "channels", "joinedTo"] as const).find((k) => next[k]);
    if (first) root.current?.querySelector<HTMLElement>(`[data-field="${first}"]`)?.focus();
    return false;
  }

  /** Saves the draft (creating it the first time). Returns its id, or null when something needs fixing. */
  async function save(): Promise<string | null> {
    if (!validate()) return null;
    try {
      const view = id
        ? await api<AnnouncementView>(`/admin/announcements/${id}`, { method: "PATCH", body: input })
        : await api<AnnouncementView>("/admin/announcements", { method: "POST", body: input });
      setSaved(JSON.stringify(input));
      if (!id) {
        setId(view.id);
        // The address follows the new draft, without reloading the page.
        window.history.replaceState(null, "", `/messages/${view.id}`);
      }
      return view.id;
    } catch (e) {
      if (e instanceof ApiError && e.fields && Object.keys(e.fields).length) setErrors(errorsFrom(Object.entries(e.fields)));
      else toast(errorMessage(e), "error");
      return null;
    }
  }

  async function onSave() {
    setBusy("save");
    const done = await save();
    setBusy(null);
    if (done) toast(t("Draft saved."));
  }

  async function onTest() {
    setBusy("test");
    try {
      const draftId = !id || dirty ? await save() : id;
      if (!draftId) return;
      await api(`/admin/announcements/${draftId}/test`, { method: "POST" });
      toast(t("Test sent to {email}", { email: viewerEmail }));
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(null);
    }
  }

  async function onSend() {
    setBusy("send");
    try {
      const draftId = !id || dirty ? await save() : id;
      if (!draftId) return;
      // The count right now, for the confirmation.
      const fresh = await api<AnnouncementAudienceCount>("/admin/announcements/audience", { method: "POST", body: { audience: input.audience, important: input.important } });
      setCount(fresh);
      if (fresh.members === 0) {
        toast(t("No members match these filters. Change the audience first."), "error");
        return;
      }
      setConfirm({ kind: "send", count: fresh });
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(null);
    }
  }

  async function send() {
    if (!id) return;
    const result = await api<AnnouncementSendResult>(`/admin/announcements/${id}/send`, { method: "POST" });
    setSaved(JSON.stringify(input));
    setConfirm(null);
    toast(t("Sending to {count} members.", { count: result.announcement.counts.recipients }));
    router.push(`/messages/${result.announcement.id}`);
  }

  async function remove() {
    if (!id) return;
    await api(`/admin/announcements/${id}`, { method: "DELETE" });
    setSaved(JSON.stringify(input));
    setConfirm(null);
    toast(t("Draft deleted."));
    router.push("/messages/drafts");
  }

  const bodyLength = form.body.trim().length;

  return (
    <div ref={root} className="flex flex-col gap-5">
      <nav aria-label={t("Breadcrumb")} className="-mb-2 text-sm">
        <Link href={id ? "/messages/drafts" : "/messages"} className="inline-flex items-center gap-1 text-secondary hover:text-ink">
          <Icon name="chevron-left" size={16} className="rtl:rotate-180" />
          {id ? "Drafts" : "Messages"}
        </Link>
      </nav>
      <PageHeader
        title={id ? t("Edit draft") : t("New message")}
        description="A message from Charter Mission to the members you choose, by email, in their inbox or as a notification."
        actions={
          <>
            {id && (
              <Button variant="ghost" size="small" disabled={busy !== null} onClick={() => setConfirm({ kind: "delete" })}>
                <Icon name="trash" size={16} />
                Delete draft
              </Button>
            )}
            <Button variant="secondary" size="small" disabled={busy !== null || (!dirty && !!id)} aria-busy={busy === "save"} onClick={() => void onSave()}>
              {busy === "save" ? "Saving…" : !dirty && id ? "Saved" : "Save draft"}
            </Button>
            <Button
              variant="secondary"
              size="small"
              disabled={busy !== null || !(form.channels.email || form.channels.notification)}
              aria-busy={busy === "test"}
              title={form.channels.email || form.channels.notification ? t("Saves the draft, then sends it only to you by email and notification") : t("Tests go by email or notification. Turn one of them on.")}
              onClick={() => void onTest()}
            >
              <Icon name="send" size={16} />
              {busy === "test" ? "Sending test…" : "Send test to me"}
            </Button>
            <Button size="small" disabled={busy !== null || noSender} aria-busy={busy === "send"} onClick={() => void onSend()}>
              {busy === "send" ? "Checking…" : "Send…"}
            </Button>
          </>
        }
      />

      {errors.form && <FormNotice tone="error">{errors.form}</FormNotice>}
      {noSender && (
        <FormNotice tone="warning">
          Inbox messages need a sender: the official account they come from.{" "}
          <Link href="/settings/messaging" className="font-medium text-primary underline">
            Choose it in Messaging settings
          </Link>{" "}
          or turn off “Message in their inbox”.
        </FormNotice>
      )}

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="flex min-w-0 flex-col gap-5">
          <section aria-labelledby={`${ids}-content`} className="flex flex-col gap-4 rounded-card border border-line bg-card p-5">
            <h2 id={`${ids}-content`} className="text-h3 text-ink">
              Message
            </h2>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <label htmlFor={`${ids}-subject`} className="text-label text-ink">
                  Subject <span aria-hidden className="text-error">*</span>
                </label>
                <span className={cn("text-xs tabular-nums", form.subject.length > SUBJECT_MAX ? "text-error" : "text-secondary")}>
                  {form.subject.length}/{SUBJECT_MAX}
                </span>
              </div>
              <input
                id={`${ids}-subject`}
                data-field="subject"
                required
                maxLength={SUBJECT_MAX + 50}
                value={form.subject}
                onChange={(e) => update("subject", e.target.value)}
                aria-invalid={errors.subject ? true : undefined}
                aria-describedby={`${ids}-subject-hint`}
                className={inputClasses(!!errors.subject)}
              />
              {errors.subject ? (
                <p id={`${ids}-subject-hint`} role="alert" className="flex items-center gap-1.5 text-xs text-error">
                  <Icon name="alert" size={14} />
                  {errors.subject}
                </p>
              ) : (
                <p id={`${ids}-subject-hint`} className="text-xs text-secondary">
                  The email’s subject, the notification’s text and the first line of the message.
                </p>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <label htmlFor={`${ids}-body`} className="text-label text-ink">
                  Message <span aria-hidden className="text-error">*</span>
                </label>
                <span className={cn("text-xs tabular-nums", bodyLength > BODY_MAX ? "text-error" : "text-secondary")}>
                  {t("{count} of {max} characters", { count: bodyLength, max: BODY_MAX })}
                </span>
              </div>
              <textarea
                id={`${ids}-body`}
                data-field="body"
                required
                rows={10}
                value={form.body}
                onChange={(e) => update("body", e.target.value)}
                aria-invalid={errors.body ? true : undefined}
                aria-describedby={`${ids}-body-hint`}
                className={inputClasses(!!errors.body, "resize-y")}
              />
              {errors.body ? (
                <p id={`${ids}-body-hint`} role="alert" className="flex items-center gap-1.5 text-xs text-error">
                  <Icon name="alert" size={14} />
                  {errors.body}
                </p>
              ) : (
                <p id={`${ids}-body-hint`} className="text-xs text-secondary">
                  Blank lines start a new paragraph. Links become clickable.
                </p>
              )}
            </div>

            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1.5 text-label text-ink">
                Link <span className="font-normal text-secondary">(optional)</span>
              </legend>
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_220px]">
                <TextField
                  data-field="linkUrl"
                  label="Address"
                  type="url"
                  inputMode="url"
                  placeholder="https://"
                  value={form.linkUrl}
                  onChange={(e) => update("linkUrl", e.target.value)}
                  error={errors.linkUrl}
                />
                <TextField
                  data-field="linkLabel"
                  label="Button label"
                  placeholder="Open link"
                  maxLength={LABEL_MAX + 10}
                  value={form.linkLabel}
                  disabled={!form.linkUrl.trim()}
                  onChange={(e) => update("linkLabel", e.target.value)}
                  error={errors.linkLabel}
                />
              </div>
              <p className="text-xs text-secondary">The email’s button, a link under the message, and where the notification opens.</p>
            </fieldset>
          </section>

          <section aria-labelledby={`${ids}-how`} className="flex flex-col gap-4 rounded-card border border-line bg-card p-5">
            <h2 id={`${ids}-how`} className="text-h3 text-ink">
              How to send it
            </h2>
            <fieldset className="flex flex-col gap-2" aria-describedby={errors.channels ? `${ids}-channels-error` : undefined}>
              <legend className="mb-1.5 text-label text-ink">
                Channels <span className="font-normal text-secondary">(at least one)</span>
              </legend>
              {(
                [
                  { key: "email", label: "Email", hint: "To their email address. Members can turn announcement emails off." },
                  { key: "message", label: "Message in their inbox", hint: "In their conversation with Charter Mission. They can reply, and replies arrive in the Inbox here." },
                  { key: "notification", label: "Notification", hint: "In their notifications on the site and app." },
                ] as const
              ).map((c, i) => (
                <label key={c.key} className="flex cursor-pointer items-start gap-3 rounded-lg border border-line px-3 py-2.5 hover:bg-surface">
                  <input
                    data-field={i === 0 ? "channels" : undefined}
                    type="checkbox"
                    checked={form.channels[c.key]}
                    onChange={(e) => update("channels", { ...form.channels, [c.key]: e.target.checked })}
                    className="mt-0.5 size-4 accent-primary"
                  />
                  <span className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium text-ink">{c.label}</span>
                    <span className="text-xs text-secondary">{c.hint}</span>
                  </span>
                </label>
              ))}
              {errors.channels && (
                <p id={`${ids}-channels-error`} role="alert" className="flex items-center gap-1.5 text-xs text-error">
                  <Icon name="alert" size={14} />
                  {errors.channels}
                </p>
              )}
            </fieldset>
            <label className="flex cursor-pointer items-start gap-3">
              <input type="checkbox" checked={form.important} onChange={(e) => update("important", e.target.checked)} className="mt-0.5 size-4 accent-primary" />
              <span className="flex flex-col gap-0.5">
                <span className="text-sm font-medium text-ink">Important service notice</span>
                <span className="text-xs text-secondary">Emailed even to members who turned off announcement emails. Use only for account, policy or security notices.</span>
              </span>
            </label>
          </section>

          <AudienceFilters value={form.audience} onChange={(a) => update("audience", a)} options={options} joinedError={errors.joinedTo ?? (joinedBad ? t("The end date can’t be before the start date") : null)} />
        </div>

        <div className="flex min-w-0 flex-col gap-5 xl:sticky xl:top-[88px]">
          <RecipientCount count={count} counting={counting} error={joinedBad ? null : countError} email={form.channels.email} important={form.important} />
          <AnnouncementPreview
            sender={sender}
            content={{
              subject: form.subject,
              body: form.body,
              linkUrl: input.linkUrl,
              linkLabel: input.linkLabel,
              channels: form.channels,
              important: form.important,
            }}
          />
        </div>
      </div>

      {confirm?.kind === "send" && (
        <ReasonDialog
          title={t("Send to {count} members?", { count: confirm.count.members })}
          description={
            <span className="flex flex-col gap-2">
              <span>
                <span className="text-secondary">{t("How:")} </span>
                <span className="font-medium text-ink">{channelsText(form.channels, t)}</span>
              </span>
              {form.channels.email && (
                <span>
                  {form.important
                    ? t("{count} get the email, including {optedOut} who turned announcement emails off.", { count: confirm.count.emailable, optedOut: confirm.count.optedOut })
                    : t("{count} get the email · {optedOut} turned announcement emails off", { count: confirm.count.emailable, optedOut: confirm.count.optedOut })}
                </span>
              )}
              {form.important && (
                <span className="flex items-start gap-2 rounded-lg bg-warning-light p-2.5 text-body">
                  <Icon name="alert" size={16} className="mt-0.5 shrink-0 text-warning" />
                  Marked as an important service notice.
                </span>
              )}
              <span className="text-secondary">It goes out in batches over the next few minutes. You can stop it while it’s sending; members already reached keep it.</span>
            </span>
          }
          confirmLabel={t("Send to {count} members", { count: confirm.count.members })}
          reasonField="none"
          onClose={() => setConfirm(null)}
          onConfirm={send}
        />
      )}
      {confirm?.kind === "delete" && (
        <ReasonDialog
          title="Delete this draft?"
          description="It’s gone for good. Nothing was sent."
          confirmLabel="Delete draft"
          tone="danger"
          reasonField="none"
          onClose={() => setConfirm(null)}
          onConfirm={remove}
        />
      )}
    </div>
  );
}

/** "{count} members", how many get the email, and a few of them. */
function RecipientCount({
  count,
  counting,
  error,
  email,
  important,
}: {
  count: AnnouncementAudienceCount | null;
  counting: boolean;
  error: string | null;
  email: boolean;
  important: boolean;
}) {
  const t = useT();
  return (
    <section aria-label={t("Recipients")} aria-busy={counting} className="flex flex-col gap-2 rounded-card border border-line bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-label text-secondary uppercase">Recipients</span>
        {counting && <span className="text-xs text-secondary">Counting…</span>}
      </div>
      {error ? (
        <p role="alert" className="text-sm text-error">
          {error}
        </p>
      ) : count === null ? (
        <span aria-hidden className="block h-7 w-32 animate-pulse rounded-md bg-muted" />
      ) : (
        <div role="status" className={cn("flex flex-col gap-2 transition-opacity", counting && "opacity-60")}>
          <span className="text-h2 text-ink tabular-nums">{t("{count} members", { count: count.members })}</span>
          {email && count.members > 0 && (
            <span className="text-sm text-body">
              {important
                ? t("{count} get the email, including {optedOut} who turned announcement emails off.", { count: count.emailable, optedOut: count.optedOut })
                : t("{count} get the email · {optedOut} turned announcement emails off", { count: count.emailable, optedOut: count.optedOut })}
            </span>
          )}
          {count.members === 0 && <span className="text-sm text-secondary">No members match these filters.</span>}
          {count.sample.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="flex -space-x-2 rtl:space-x-reverse">
                {count.sample.map((m) => (
                  <Avatar key={m.id} name={m.name} src={m.avatarUrl ?? undefined} tone={m.tone} size={24} className="ring-2 ring-card" />
                ))}
              </span>
              <span className="min-w-0 truncate text-xs text-secondary">
                {count.sample
                  .slice(0, 3)
                  .map((m) => m.name)
                  .join(", ")}
                {count.members > Math.min(3, count.sample.length) && "…"}
              </span>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
