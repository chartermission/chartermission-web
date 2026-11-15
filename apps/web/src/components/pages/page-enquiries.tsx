"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { EnquiryReplyInput, type EnquiriesQuery, type EnquiryView, type Page, type PageRef } from "@chartermission/contracts";
import { Button, Chip, Icon, Panel, SegmentedControl, buttonClasses, cn, type ChipTone } from "@chartermission/ui";
import { FieldError, inputClasses } from "@/components/auth/fields";
import { ErrorNotice } from "@/components/social/errors";
import { memberHref } from "@/components/social/links";
import { MemberAvatar, TimeAgo } from "@/components/social/post-parts";
import { Bone, EmptyState } from "@/components/social/skeletons";
import { toast } from "@/components/social/toast";
import { api } from "@/lib/api/client";
import { NoTranslate } from "@/i18n/auto";
import { T, useT } from "@/i18n/client";

type Status = EnquiriesQuery["status"];

const REPLY_MAX = 4000;
const LIMIT = 20;

const STATUS_CHIP: Record<EnquiryView["status"], { label: string; tone: ChipTone }> = {
  new: { label: "New", tone: "warning" },
  replied: { label: "Replied", tone: "success" },
  closed: { label: "Closed", tone: "neutral" },
};

/**
 * Enquiries sent to a page (GET /pages/{slug}/enquiries), for its admins: filter by status, reply
 * (the reply goes to the member in Messages) and close them.
 */
export function PageEnquiries({ page, initial, initialStatus }: { page: PageRef; initial: Page<EnquiryView>; initialStatus: Status }) {
  const t = useT();
  const router = useRouter();
  const [status, setStatus] = useState<Status>(initialStatus);
  const [items, setItems] = useState<EnquiryView[]>(initial.items);
  const [cursor, setCursor] = useState<string | null>(initial.nextCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const first = useRef(true);

  const filters: { value: Status; label: string }[] = [
    { value: "new", label: t("New") },
    { value: "replied", label: t("Replied") },
    { value: "closed", label: t("Closed") },
    { value: "all", label: t("All") },
  ];

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const controller = new AbortController();
    api<Page<EnquiryView>>(`/pages/${page.slug}/enquiries`, { query: { status, limit: LIMIT }, signal: controller.signal }).then(
      (result) => {
        setItems(result.items);
        setCursor(result.nextCursor);
        setLoading(false);
      },
      (e: unknown) => {
        if (controller.signal.aborted) return;
        setError(e);
        setLoading(false);
      },
    );
    return () => controller.abort();
  }, [page.slug, status]);

  function choose(next: Status) {
    if (next === status) return;
    setError(null);
    setLoading(true);
    setStatus(next);
    const url = new URL(window.location.href);
    if (next === "new") url.searchParams.delete("status");
    else url.searchParams.set("status", next);
    window.history.replaceState(window.history.state, "", url);
  }

  async function more() {
    if (!cursor) return;
    setLoading(true);
    setError(null);
    try {
      const result = await api<Page<EnquiryView>>(`/pages/${page.slug}/enquiries`, { query: { status, limit: LIMIT, cursor } });
      setItems((current) => [...current, ...result.items.filter((item) => !current.some((c) => c.id === item.id))]);
      setCursor(result.nextCursor);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }

  const update = (next: EnquiryView) => {
    setItems((current) => current.map((item) => (item.id === next.id ? next : item)));
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-4">
      <SegmentedControl items={filters} value={status} onChange={choose} label={t("Show enquiries")} className="self-start" />

      {error ? <ErrorNotice error={error} onRetry={cursor && items.length ? () => void more() : undefined} /> : null}

      <div aria-busy={loading} aria-live="polite" className={cn("flex flex-col gap-3", loading && items.length > 0 && "opacity-70")}>
        {loading && items.length === 0 ? (
          <EnquirySkeleton />
        ) : items.length === 0 ? (
          <EmptyState icon="mail" title={status === "new" ? t("No new enquiries") : t("No enquiries here")}>
            {status === "new" ? "When members contact the page or enquire about a product or service, their messages appear here." : "Try another filter."}
          </EmptyState>
        ) : (
          <ul className="flex flex-col gap-3">
            {items.map((item) => (
              <li key={item.id}>
                <EnquiryItem pageSlug={page.slug} enquiry={item} onChange={update} />
              </li>
            ))}
          </ul>
        )}
      </div>

      {cursor && items.length > 0 && (
        <Button variant="secondary" className="self-center" disabled={loading} onClick={() => void more()}>
          {loading ? "Loading…" : "Load more"}
        </Button>
      )}
    </div>
  );
}

function EnquirySkeleton() {
  return (
    <Panel aria-hidden="true" className="flex flex-col gap-3 p-5">
      <div className="flex items-center gap-3">
        <Bone className="size-10 shrink-0 rounded-full" />
        <Bone className="h-4 w-1/3" />
      </div>
      <Bone className="h-3.5 w-[90%]" />
      <Bone className="h-3.5 w-[70%]" />
    </Panel>
  );
}

function EnquiryItem({ pageSlug, enquiry, onChange }: { pageSlug: string; enquiry: EnquiryView; onChange: (next: EnquiryView) => void }) {
  const t = useT();
  const id = useId();
  const [reply, setReply] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<"reply" | "close" | null>(null);
  const chip = STATUS_CHIP[enquiry.status];

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const parsed = EnquiryReplyInput.safeParse({ message: reply });
    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message ?? t("Write a reply"));
      document.getElementById(`${id}-reply`)?.focus();
      return;
    }
    setBusy("reply");
    try {
      const next = await api<EnquiryView>(`/pages/${pageSlug}/enquiries/${enquiry.id}/reply`, { method: "POST", body: parsed.data });
      setReply("");
      onChange(next);
      toast.success(t("Reply sent to {name}", { name: enquiry.from.name }));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  }

  async function close() {
    setError(null);
    setBusy("close");
    try {
      // The API may answer with the enquiry or with a plain { ok: true }.
      const next = await api<EnquiryView | { ok: true } | undefined>(`/pages/${pageSlug}/enquiries/${enquiry.id}/close`, { method: "POST" });
      onChange(next && "id" in next ? next : { ...enquiry, status: "closed" });
      toast.success("Enquiry closed");
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  }

  return (
    <article aria-labelledby={`${id}-from`} className="flex flex-col gap-3 rounded-card border border-line bg-card p-5 max-sm:p-4">
      <header className="flex items-start gap-3">
        <MemberAvatar member={enquiry.from} size={40} link />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Link id={`${id}-from`} href={memberHref(enquiry.from.handle)} className="truncate text-md font-medium text-ink hover:underline">
              {enquiry.from.name}
            </Link>
            <Chip tone={chip.tone} className="px-2! py-0.5! text-xs!">
              {t(chip.label)}
            </Chip>
          </div>
          {enquiry.from.headline && (
            <p className="truncate text-xs text-secondary">
              <NoTranslate>{enquiry.from.headline}</NoTranslate>
            </p>
          )}
        </div>
        <TimeAgo iso={enquiry.createdAt} className="shrink-0 text-xs text-secondary" />
      </header>

      <p className="text-xs font-medium text-secondary">
        {enquiry.about ? (
          <>
            {enquiry.about.type === "product" ? t("About the product") : t("About the service")}{" "}
            <span className="text-ink">
              <NoTranslate>{enquiry.about.title}</NoTranslate>
            </span>
          </>
        ) : (
          "General enquiry"
        )}
      </p>

      <p className="whitespace-pre-line break-words text-md text-body">
        <NoTranslate>{enquiry.message}</NoTranslate>
      </p>

      {enquiry.repliedBy && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-[10px] bg-success-light px-3.5 py-2.5 text-sm text-ink">
          <Icon name="check" size={16} className="shrink-0 text-success" />
          <span className="min-w-0 flex-1">
            <T vars={{ name: enquiry.repliedBy.name }}>{"Replied by {name}"}</T>
          </span>
          {enquiry.conversationId && (
            <Link href={`/messages/${enquiry.conversationId}`} className="font-medium text-primary-light hover:underline">
              Open conversation
            </Link>
          )}
        </div>
      )}

      {enquiry.status === "new" && (
        <form noValidate onSubmit={send} className="flex flex-col gap-2 border-t border-line pt-3">
          <label htmlFor={`${id}-reply`} className="text-sm font-medium text-ink">
            <T vars={{ name: enquiry.from.name }}>{"Reply to {name}"}</T>
          </label>
          <textarea
            id={`${id}-reply`}
            value={reply}
            onChange={(event) => {
              setReply(event.target.value);
              if (fieldError) setFieldError(null);
            }}
            rows={3}
            maxLength={REPLY_MAX}
            aria-invalid={fieldError ? true : undefined}
            aria-describedby={fieldError ? `${id}-reply-error` : `${id}-reply-hint`}
            placeholder="Your reply goes to them as a message from you, and the conversation carries on in Messages."
            className={inputClasses(!!fieldError, "h-auto resize-y py-2.5")}
          />
          {fieldError ? (
            <FieldError id={`${id}-reply-error`} message={fieldError} />
          ) : (
            <p id={`${id}-reply-hint`} className="text-xs text-secondary">
              They’ll see it in Messages, from you.
            </p>
          )}
          {error ? <ErrorNotice error={error} /> : null}
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant="ghost" size="small" disabled={busy !== null} onClick={() => void close()}>
              {busy === "close" ? "Closing…" : "Close without replying"}
            </Button>
            <Button type="submit" size="small" disabled={busy !== null}>
              <Icon name="send" size={14} />
              {busy === "reply" ? "Sending…" : "Send reply"}
            </Button>
          </div>
        </form>
      )}

      {enquiry.status === "replied" && (
        <div className="flex flex-col gap-2">
          {error ? <ErrorNotice error={error} /> : null}
          <div className="flex justify-end">
            <button type="button" disabled={busy !== null} onClick={() => void close()} className={buttonClasses({ variant: "secondary", size: "small" })}>
              {busy === "close" ? "Closing…" : "Close"}
            </button>
          </div>
        </div>
      )}
    </article>
  );
}
