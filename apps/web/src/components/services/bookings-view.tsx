"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useId, useState, useTransition } from "react";
import { BOOKING_CANCEL_REASON_MAX, CONSULTATION_MODE_LABELS, type BookingView, type Page } from "@chartermission/contracts";
import { Button, Chip, FilterSelect, Icon, Panel, SegmentedControl, buttonClasses, cn } from "@chartermission/ui";
import { inputClasses } from "@/components/auth/fields";
import { badgeParts, formatDay, formatRange } from "@/components/events/time";
import { useViewerZone } from "@/components/events/use-viewer-zone";
import { MessageMemberButton } from "@/components/network/message-member";
import { EnquiryButton } from "@/components/pages/enquiry-dialog";
import { PageLogo } from "@/components/pages/page-logo";
import { Dialog } from "@/components/social/dialog";
import { ErrorNotice } from "@/components/social/errors";
import { MemberAvatar } from "@/components/social/post-parts";
import { EmptyState } from "@/components/social/skeletons";
import { toast } from "@/components/social/toast";
import { api } from "@/lib/api/client";
import { NoTranslate } from "@/i18n/auto";
import { useIntlTag, usePathname, useT } from "@/i18n/client";
import { hostHref, hostName, modeIcon, serviceHref } from "./format";
import { MeetingDetails } from "./service-parts";

export type BookingsRole = "booker" | "host";
export type BookingsWhen = "upcoming" | "past" | "cancelled";
export type HostPageOption = { id: string; name: string };

const PAGE = 20;

/** Cancel with an optional reason (POST /bookings/{id}/cancel). */
function CancelBookingDialog({ booking, other, onCancelled, onClose }: { booking: BookingView; other: string; onCancelled: (b: BookingView) => void; onClose: () => void }) {
  const t = useT();
  const id = useId();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function cancel(from: HTMLElement) {
    setBusy(true);
    setError(null);
    try {
      const updated = await api<BookingView>(`/bookings/${booking.id}/cancel`, { method: "POST", body: { reason: reason.trim() || null } });
      onCancelled(updated ?? { ...booking, status: "cancelled", cancelledBy: booking.viewer.role, cancelReason: reason.trim() || null, cancelledAt: new Date().toISOString() });
      from.closest("dialog")?.close();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={t("Cancel this booking?")}
      description={t("{name} gets a notification straight away.", { name: other })}
      onClose={onClose}
      width={460}
      initialFocus="textarea"
      footer={
        <>
          <Button variant="secondary" onClick={(e) => e.currentTarget.closest("dialog")?.close()} disabled={busy}>
            Keep it
          </Button>
          <Button onClick={(e) => void cancel(e.currentTarget)} disabled={busy} aria-busy={busy} className="bg-error hover:bg-error/90">
            {busy ? "Cancelling…" : "Cancel booking"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-3">
          <label htmlFor={`${id}-reason`} className="text-sm font-medium text-ink">
            Reason
          </label>
          <span className="text-xs text-secondary">Optional</span>
        </div>
        <textarea
          id={`${id}-reason`}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={BOOKING_CANCEL_REASON_MAX}
          rows={3}
          placeholder="e.g. Something came up. Could we find another time?"
          className={cn(inputClasses(false), "h-auto resize-y py-2.5")}
        />
        <p className="text-end text-xs text-secondary">
          {reason.length} / {BOOKING_CANCEL_REASON_MAX}
        </p>
      </div>
      <div aria-live="polite">{error ? <ErrorNotice error={error} /> : null}</div>
    </Dialog>
  );
}

/**
 * One booking, from either side: who it's with, when (in the viewer's zone), how you meet, the
 * meeting details, the booker's note, and Add to calendar / Message / Cancel.
 */
export function BookingRow({ booking: initial, onChange }: { booking: BookingView; onChange?: (b: BookingView) => void }) {
  const t = useT();
  const intl = useIntlTag();
  const viewerZone = useViewerZone();
  const [booking, setBooking] = useState(initial);
  const [cancelling, setCancelling] = useState(false);
  const zone = viewerZone ?? booking.hostTimezone;
  const badge = badgeParts(booking.startsAt, zone, intl);
  const asHost = booking.viewer.role === "host";
  const other = asHost ? booking.booker.name : hostName(booking.host);
  const cancelled = booking.status === "cancelled";
  const live = !cancelled && !booking.past;

  const message = asHost ? (
    <MessageMemberButton memberId={booking.booker.id} name={booking.booker.name} size="small" />
  ) : booking.host.type === "member" ? (
    <MessageMemberButton memberId={booking.host.member.id} name={booking.host.member.name} size="small" />
  ) : (
    <EnquiryButton page={booking.host.page} about={{ type: "service", id: booking.service.id, title: booking.service.title }} label={t("Message")} />
  );

  return (
    <article className="flex gap-4 p-4 max-sm:gap-3">
      <div
        aria-hidden="true"
        className={cn("flex w-14 shrink-0 flex-col items-center self-start rounded-lg border py-1.5", cancelled ? "border-line text-disabled" : "border-primary-tint bg-primary-tint-2 text-primary")}
      >
        <span className="text-[11px] font-semibold tracking-wide">{badge.month}</span>
        <span className="text-h3 leading-tight">{badge.day}</span>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-col gap-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-md font-medium text-ink">
              <Link href={serviceHref(booking.service.id)} className="hover:underline">
                <NoTranslate>{booking.service.title}</NoTranslate>
              </Link>
            </h3>
            {cancelled && <Chip tone="error">Cancelled</Chip>}
          </div>
          <p className={cn("text-sm tabular-nums", cancelled ? "text-secondary line-through" : "text-body")}>
            {formatDay(booking.startsAt, zone, { weekday: "long", intl })} · {formatRange(booking.startsAt, booking.endsAt, zone, intl)}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-secondary">
          <span className="flex min-w-0 items-center gap-2">
            {asHost ? (
              <MemberAvatar member={booking.booker} size={24} link />
            ) : booking.host.type === "page" ? (
              <PageLogo name={booking.host.page.name} src={booking.host.page.logoUrl} size={24} />
            ) : (
              <MemberAvatar member={booking.host.member} size={24} link />
            )}
            <Link href={asHost ? `/${booking.booker.handle}` : hostHref(booking.host)} className="truncate hover:underline">
              {asHost ? t("Booked by {name}", { name: other }) : t("With {name}", { name: other })}
            </Link>
          </span>
          <span className="flex items-center gap-1.5">
            <Icon name={modeIcon[booking.service.mode]} size={15} className="shrink-0" />
            {CONSULTATION_MODE_LABELS[booking.service.mode]}
            {booking.locationHint && (
              <NoTranslate>
                <span dir="auto"> · {booking.locationHint}</span>
              </NoTranslate>
            )}
          </span>
        </div>

        {live && booking.meetingDetails && <MeetingDetails value={booking.meetingDetails} className="self-stretch sm:self-start" />}

        {booking.note && (
          <div className="flex flex-col gap-0.5 rounded-lg bg-muted px-3 py-2">
            <p className="text-xs font-medium text-secondary">{asHost ? "Their note" : "Your note"}</p>
            <NoTranslate>
              <p dir="auto" className="whitespace-pre-line break-words text-sm text-body">
                {booking.note}
              </p>
            </NoTranslate>
          </div>
        )}

        {cancelled && (
          <p className="text-sm text-secondary">
            {booking.cancelledBy === booking.viewer.role ? "You cancelled this booking." : t("{name} cancelled this booking.", { name: other })}
            {booking.cancelReason && (
              <>
                {" "}
                <NoTranslate>
                  <span dir="auto" className="text-body">
                    “{booking.cancelReason}”
                  </span>
                </NoTranslate>
              </>
            )}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          {live && (
            <a href={`/api/v1/bookings/${booking.id}/calendar.ics`} download className={buttonClasses({ variant: "secondary", size: "small" })}>
              <Icon name="calendar" size={16} />
              Add to calendar
            </a>
          )}
          {message}
          {booking.viewer.canCancel && live && (
            <Button variant="ghost" size="small" onClick={() => setCancelling(true)} className="text-error hover:bg-error-light">
              <Icon name="x" size={16} />
              Cancel
              <span className="sr-only">
                {" "}
                <NoTranslate>{booking.service.title}</NoTranslate>
              </span>
            </Button>
          )}
        </div>
      </div>
      {cancelling && (
        <CancelBookingDialog
          booking={booking}
          other={other}
          onCancelled={(b) => {
            setBooking(b);
            onChange?.(b);
            toast.success("Booking cancelled");
          }}
          onClose={() => setCancelling(false)}
        />
      )}
    </article>
  );
}

function List({ initial, role, when, pageId, viewerHandle }: { initial: Page<BookingView>; role: BookingsRole; when: BookingsWhen; pageId: string | null; viewerHandle: string }) {
  const [items, setItems] = useState(initial.items);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const more = useCallback(async () => {
    if (!cursor) return;
    setLoading(true);
    setError(null);
    try {
      const page = await api<Page<BookingView>>("/bookings", { query: { role, when, pageId, cursor, limit: PAGE } });
      setItems((current) => [...current, ...page.items.filter((b) => !current.some((c) => c.id === b.id))]);
      setCursor(page.nextCursor);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [cursor, role, when, pageId]);

  if (!items.length) {
    if (when === "upcoming" && role === "host") {
      return (
        <EmptyState
          icon="calendar"
          title="Nobody has booked yet"
          actions={
            <>
              <Link href={pageId ? "/pages" : `/${viewerHandle}#services`} className={buttonClasses({ variant: "secondary", size: "small" })}>
                {pageId ? "Manage pages" : "Your services"}
              </Link>
              {!pageId && (
                <Link href="/settings/availability" className={buttonClasses({ variant: "ghost", size: "small" })}>
                  Set availability
                </Link>
              )}
            </>
          }
        >
          Offer a free consultation as a service, set your hours, and bookings show up here.
        </EmptyState>
      );
    }
    return (
      <EmptyState icon="calendar" title={when === "past" ? "No past bookings" : when === "cancelled" ? "No cancelled bookings" : "No upcoming bookings"}>
        {when === "upcoming"
          ? "Book a free consultation from a member’s profile or a page, and it shows up here with reminders a day and an hour before."
          : when === "past"
            ? "Consultations move here after they end."
            : "Bookings that you or the other person cancelled show up here."}
      </EmptyState>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Panel className="overflow-hidden">
        <ul className="flex flex-col divide-y divide-line">
          {items.map((booking) => (
            <li key={booking.id}>
              <BookingRow booking={booking} onChange={(b) => setItems((current) => current.map((x) => (x.id === b.id ? b : x)))} />
            </li>
          ))}
        </ul>
      </Panel>
      {error ? (
        <ErrorNotice error={error} onRetry={() => void more()} />
      ) : (
        cursor && (
          <button type="button" onClick={() => void more()} disabled={loading} className={cn(buttonClasses({ variant: "secondary", size: "small" }), "self-center")}>
            {loading ? "Loading…" : "Load more"}
          </button>
        )
      )}
      <p role="status" className="sr-only">
        {loading ? "Loading more bookings…" : ""}
      </p>
    </div>
  );
}

/**
 * Bookings: Booked by me / With me (and, for page admins, a page as host), each with Upcoming /
 * Past / Cancelled (GET /bookings, paged). The choice lives in the address so it can be shared.
 */
export function BookingsView({
  initial,
  error,
  role,
  when,
  pageId,
  pages,
  viewerHandle,
}: {
  initial: Page<BookingView> | null;
  error: unknown;
  role: BookingsRole;
  when: BookingsWhen;
  pageId: string | null;
  pages: HostPageOption[];
  viewerHandle: string;
}) {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [target, setTarget] = useState({ role, when, pageId });
  const shown = pending ? target : { role, when, pageId };

  function go(next: { role: BookingsRole; when: BookingsWhen; pageId: string | null }) {
    setTarget(next);
    const params = new URLSearchParams();
    if (next.role !== "booker") params.set("role", next.role);
    if (next.role === "host" && next.pageId) params.set("page", next.pageId);
    if (next.when !== "upcoming") params.set("when", next.when);
    const qs = params.toString();
    startTransition(() => router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false }));
  }

  const roles: { value: BookingsRole; label: string }[] = [
    { value: "booker", label: t("Booked by me") },
    { value: "host", label: t("With me") },
  ];
  const whens = [
    { value: "upcoming", label: t("Upcoming") },
    { value: "past", label: t("Past") },
    { value: "cancelled", label: t("Cancelled") },
  ] as const;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div role="tablist" aria-label="Bookings" className="flex gap-6 border-b border-line">
          {roles.map((r) => {
            const selected = shown.role === r.value;
            return (
              <button
                key={r.value}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls="bookings-panel"
                onClick={() => go({ role: r.value, when: shown.when, pageId: r.value === "host" ? shown.pageId : null })}
                className={cn("-mb-px border-b-2 pb-2 text-md font-medium", selected ? "border-primary text-primary" : "border-transparent text-secondary hover:text-ink")}
              >
                {r.label}
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {shown.role === "host" && pages.length > 0 && (
            <FilterSelect
              label={t("Whose bookings")}
              value={shown.pageId ?? ""}
              onChange={(e) => go({ role: "host", when: shown.when, pageId: e.target.value || null })}
              options={[{ value: "", label: t("Mine") }, ...pages.map((p) => ({ value: p.id, label: p.name }))]}
            />
          )}
          <SegmentedControl label={t("When")} size="small" items={whens} value={shown.when} onChange={(value) => go({ role: shown.role, when: value, pageId: shown.pageId })} />
        </div>
      </div>
      <div id="bookings-panel" role="tabpanel" aria-busy={pending || undefined} className={cn("transition-opacity", pending && "opacity-60")}>
        {initial ? (
          <List key={`${role}-${when}-${pageId ?? ""}`} initial={initial} role={role} when={when} pageId={pageId} viewerHandle={viewerHandle} />
        ) : (
          <ErrorNotice error={error} onRetry={() => router.refresh()} />
        )}
      </div>
    </div>
  );
}
