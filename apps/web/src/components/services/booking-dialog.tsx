"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { BOOKING_NOTE_MAX, type BookingView, type ServiceView, type SlotsView } from "@chartermission/contracts";
import { Button, Icon, buttonClasses, cn, type ButtonProps } from "@chartermission/ui";
import { inputClasses } from "@/components/auth/fields";
import { dayKey, formatClock, formatLongDay, formatRange, gmtLabel, sameWallClock, zoneCity } from "@/components/events/time";
import { useNow, useViewerZone } from "@/components/events/use-viewer-zone";
import { Dialog } from "@/components/social/dialog";
import { ErrorNotice } from "@/components/social/errors";
import { Bone } from "@/components/social/skeletons";
import { api, isApiError } from "@/lib/api/client";
import { NoTranslate } from "@/i18n/auto";
import { useIntlTag, useT } from "@/i18n/client";
import { addDays, formatDate, hostName } from "./format";
import { ConsultationFacts, MeetingDetails } from "./service-parts";

/** Days shown at once in the date strip. */
const DAYS = 14;

type Slot = { startsAt: string; endsAt: string };
type Loaded = { key: string; data?: SlotsView; error?: unknown };
type Step = "pick" | "review" | "done";

function daysBetween(from: string, to: string): number {
  const ms = (d: string) => {
    const [y, m, day] = d.split("-").map(Number) as [number, number, number];
    return Date.UTC(y, m - 1, day);
  };
  return Math.round((ms(to) - ms(from)) / 86_400_000);
}

/** "Book" button that opens the booking flow. Render it only when `service.viewer.canBook`. */
export function BookButton({
  service,
  size,
  block,
  variant = "accent",
  label,
}: {
  service: ServiceView;
  size?: ButtonProps["size"];
  block?: boolean;
  variant?: ButtonProps["variant"];
  label?: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant} size={size} block={block} onClick={() => setOpen(true)} aria-haspopup="dialog">
        <Icon name="calendar" size={16} />
        {label ?? t("Book")}
        <span className="sr-only">
          <NoTranslate> {service.title}</NoTranslate>
        </span>
      </Button>
      {open && <BookingDialog service={service} onClose={() => setOpen(false)} />}
    </>
  );
}

/**
 * Book a free consultation: pick a day (next 14 days, paging on up to the service's window), pick a
 * time in the viewer's zone (or the host's), add a note, confirm. A 409 means someone else took the
 * slot a moment ago: the times reload and the member picks again.
 */
export function BookingDialog({ service, onClose, onBooked }: { service: ServiceView; onClose: () => void; onBooked?: (booking: BookingView) => void }) {
  const t = useT();
  const intl = useIntlTag();
  const router = useRouter();
  const uid = useId();
  const viewerZone = useViewerZone() ?? "UTC";
  const now = useNow();

  const [hostZone, setHostZone] = useState<string | null>(null);
  const [inHostZone, setInHostZone] = useState(false);
  const zone = inHostZone && hostZone ? hostZone : viewerZone;
  const [offset, setOffset] = useState(0);
  const [nonce, setNonce] = useState(0);
  const today = dayKey(new Date(now), zone);
  const from = addDays(today, offset);
  const key = `${from}|${zone}|${nonce}`;
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  const [day, setDay] = useState<string | null>(null);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [step, setStep] = useState<Step>("pick");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [taken, setTaken] = useState(false);
  const [booking, setBooking] = useState<BookingView | null>(null);
  const stepRef = useRef<HTMLDivElement>(null);
  const firstStep = useRef(true);

  useEffect(() => {
    const controller = new AbortController();
    api<SlotsView>(`/services/${service.id}/slots`, { query: { from, days: DAYS, tz: zone }, signal: controller.signal })
      .then((data) => {
        setLoaded({ key, data });
        setHostZone(data.hostTimezone);
      })
      .catch((e: unknown) => {
        if (!controller.signal.aborted) setLoaded({ key, error: e });
      });
    return () => controller.abort();
  }, [service.id, from, zone, key]);

  // Move focus to the new step's content so keyboard and screen reader users follow along.
  useEffect(() => {
    if (firstStep.current) {
      firstStep.current = false;
      return;
    }
    stepRef.current?.focus();
  }, [step]);

  const loading = loaded?.key !== key;
  const data = loading ? undefined : loaded?.data;
  const loadError = loading ? null : loaded?.error;
  const dates = Array.from({ length: DAYS }, (_, i) => addDays(from, i));
  const slotsByDay = new Map((data?.days ?? []).map((d) => [d.date, d.slots]));
  const openDates = dates.filter((d) => (slotsByDay.get(d)?.length ?? 0) > 0);
  const shownDay = day && dates.includes(day) ? day : (openDates[0] ?? dates[0]!);
  const daySlots = slotsByDay.get(shownDay) ?? [];
  const lastDay = addDays(today, service.windowDays);
  const canLater = daysBetween(from, lastDay) >= DAYS;
  const zonesDiffer = !!hostZone && !sameWallClock(hostZone, viewerZone, new Date(now));
  const jumpTo = data && openDates.length === 0 && data.nextAvailable && daysBetween(today, data.nextAvailable) >= 0 ? data.nextAvailable : null;
  const host = hostName(service.host);

  function page(next: number) {
    setOffset(Math.max(0, next));
    setDay(null);
    setTaken(false);
  }

  function close() {
    stepRef.current?.closest("dialog")?.close();
  }

  async function confirm() {
    if (!slot || busy) return;
    setBusy(true);
    setError(null);
    try {
      const made = await api<BookingView>(`/services/${service.id}/bookings`, { method: "POST", body: { startsAt: slot.startsAt, note: note.trim() || null } });
      setBooking(made);
      setStep("done");
      onBooked?.(made);
    } catch (e) {
      if (isApiError(e) && (e.status === 409 || e.code === "CONFLICT")) {
        setSlot(null);
        setStep("pick");
        setTaken(true);
        setNonce((n) => n + 1);
      } else {
        setError(e);
      }
    } finally {
      setBusy(false);
    }
  }

  const footer =
    step === "pick" ? (
      <>
        <Button variant="secondary" onClick={close}>
          Cancel
        </Button>
        <Button variant="accent" disabled={!slot} onClick={() => setStep("review")}>
          Continue
        </Button>
      </>
    ) : step === "review" ? (
      <>
        <Button variant="secondary" onClick={() => setStep("pick")} disabled={busy}>
          Back
        </Button>
        <Button variant="accent" onClick={() => void confirm()} disabled={busy} aria-busy={busy}>
          {busy ? "Booking…" : "Confirm booking"}
        </Button>
      </>
    ) : (
      <Button onClick={close}>Done</Button>
    );

  return (
    <Dialog
      title={step === "done" ? t("You’re booked") : t("Book {title}", { title: service.title })}
      description={
        step === "done" ? undefined : (
          <span className="flex flex-col gap-1.5 pt-0.5">
            <span>{t("A free consultation with {name}", { name: host })}</span>
            <ConsultationFacts durationMinutes={service.durationMinutes} mode={service.mode} locationHint={service.locationHint} />
          </span>
        )
      }
      onClose={() => {
        if (booking) router.refresh();
        onClose();
      }}
      width={560}
      footer={footer}
    >
      <div ref={stepRef} tabIndex={-1} className="flex flex-col gap-4 outline-none">
        {step === "pick" && (
          <>
            {taken && (
              <p role="alert" className="flex items-start gap-2 rounded-lg bg-warning-light px-3 py-2.5 text-sm text-ink">
                <Icon name="alert" size={16} className="mt-0.5 shrink-0 text-warning" />
                Someone just booked that time. Here are the times still open.
              </p>
            )}

            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm">
              <p className="flex items-center gap-1.5 text-secondary">
                <Icon name="globe" size={15} className="shrink-0" />
                {t("Times in {zone}", { zone: `${zoneCity(zone)} (${gmtLabel(zone, now)})` })}
              </p>
              {zonesDiffer && hostZone && (
                <button type="button" onClick={() => setInHostZone((v) => !v)} className="rounded-sm font-medium text-primary-light hover:underline">
                  {inHostZone ? t("Use my time zone ({zone})", { zone: zoneCity(viewerZone) }) : t("Use the host’s time zone ({zone})", { zone: zoneCity(hostZone) })}
                </button>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => page(offset - DAYS)}
                disabled={offset === 0}
                aria-label="Earlier dates"
                className="shrink-0 rounded-md p-1.5 text-secondary hover:bg-muted hover:text-ink disabled:opacity-30"
              >
                <Icon name="chevron-left" size={18} className="rtl:rotate-180" />
              </button>
              <ul aria-label="Choose a day" className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto pb-1">
                {dates.map((date) => {
                  const open = openDates.includes(date);
                  const selected = date === shownDay;
                  const beyond = daysBetween(date, lastDay) < 0;
                  return (
                    <li key={date} className="shrink-0">
                      <button
                        type="button"
                        aria-pressed={selected}
                        disabled={beyond}
                        onClick={() => {
                          setDay(date);
                          setTaken(false);
                        }}
                        aria-label={`${formatDate(date, intl, { weekday: "long", day: "numeric", month: "long" })}${open ? "" : ` · ${t("No open times")}`}`}
                        className={cn(
                          "flex w-12 flex-col items-center gap-0.5 rounded-lg border py-1.5 text-xs transition-colors disabled:opacity-30",
                          selected
                            ? "border-primary bg-primary text-inverse"
                            : open
                              ? "border-primary-tint bg-primary-tint-2 text-primary hover:border-primary"
                              : "border-line text-disabled hover:border-line-strong",
                        )}
                      >
                        <span>{formatDate(date, intl, { weekday: "short" })}</span>
                        <span className="text-md font-semibold">{formatDate(date, intl, { day: "numeric" })}</span>
                        <span>{formatDate(date, intl, { month: "short" })}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              <button
                type="button"
                onClick={() => page(offset + DAYS)}
                disabled={!canLater}
                aria-label="Later dates"
                className="shrink-0 rounded-md p-1.5 text-secondary hover:bg-muted hover:text-ink disabled:opacity-30"
              >
                <Icon name="chevron-right" size={18} className="rtl:rotate-180" />
              </button>
            </div>

            <div aria-busy={loading || undefined} className="flex flex-col gap-2">
              <h3 className="text-sm font-medium text-ink">{formatDate(shownDay, intl, { weekday: "long", day: "numeric", month: "long" })}</h3>
              <p role="status" className="sr-only">
                {loading ? t("Loading open times…") : ""}
              </p>
              {loading ? (
                <div aria-hidden="true" className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {Array.from({ length: 8 }, (_, i) => (
                    <Bone key={i} className="h-10 rounded-lg" />
                  ))}
                </div>
              ) : loadError ? (
                <ErrorNotice error={loadError} onRetry={() => setNonce((n) => n + 1)} />
              ) : daySlots.length > 0 ? (
                <ul aria-label="Choose a time" className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {daySlots.map((s) => {
                    const selected = slot?.startsAt === s.startsAt;
                    return (
                      <li key={s.startsAt}>
                        <button
                          type="button"
                          aria-pressed={selected}
                          onClick={() => {
                            setSlot(s);
                            setTaken(false);
                          }}
                          className={cn(
                            "h-10 w-full rounded-lg border text-sm font-medium tabular-nums transition-colors",
                            selected ? "border-primary bg-primary text-inverse" : "border-line-strong bg-card text-ink hover:border-primary hover:text-primary",
                          )}
                        >
                          {formatClock(s.startsAt, zone)}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="flex flex-col items-start gap-2 rounded-lg bg-muted px-3 py-3 text-sm text-secondary">
                  <p>{openDates.length > 0 ? "No open times on this day. Try one of the highlighted days." : "No open times in these two weeks."}</p>
                  {jumpTo ? (
                    <button type="button" onClick={() => page(daysBetween(today, jumpTo))} className="rounded-sm font-medium text-primary-light hover:underline">
                      {t("Go to the next open day ({date})", { date: formatDate(jumpTo, intl) })}
                    </button>
                  ) : (
                    openDates.length === 0 && canLater && (
                      <button type="button" onClick={() => page(offset + DAYS)} className="rounded-sm font-medium text-primary-light hover:underline">
                        See later dates
                      </button>
                    )
                  )}
                </div>
              )}
            </div>
          </>
        )}

        {step === "review" && slot && (
          <>
            <div className="flex items-start gap-3 rounded-lg border border-line p-3.5">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-tint text-primary">
                <Icon name="calendar" size={20} />
              </span>
              <div className="flex min-w-0 flex-col gap-0.5">
                <p className="text-md font-medium text-ink">{formatLongDay(slot.startsAt, zone, intl)}</p>
                <p className="text-sm text-body tabular-nums">{formatRange(slot.startsAt, slot.endsAt, zone, intl)}</p>
                <p className="text-xs text-secondary">
                  <NoTranslate>{service.title}</NoTranslate>
                </p>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-3">
                <label htmlFor={`${uid}-note`} className="text-sm font-medium text-ink">
                  What would you like to talk about?
                </label>
                <span className="text-xs text-secondary">Optional</span>
              </div>
              <textarea
                id={`${uid}-note`}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={BOOKING_NOTE_MAX}
                rows={4}
                aria-describedby={`${uid}-note-hint`}
                placeholder="A line or two helps them prepare."
                className={cn(inputClasses(false), "h-auto resize-y py-2.5")}
              />
              <p id={`${uid}-note-hint`} className="flex justify-between gap-3 text-xs text-secondary">
                <span>{t("Only {name} sees this.", { name: host })}</span>
                <span>
                  {note.length} / {BOOKING_NOTE_MAX}
                </span>
              </p>
            </div>
            <p className="text-xs text-secondary">You get the meeting details once it’s booked. We remind you a day and an hour before.</p>
            {error ? <ErrorNotice error={error} /> : null}
          </>
        )}

        {step === "done" && booking && <BookingConfirmation booking={booking} zone={viewerZone} />}
      </div>
    </Dialog>
  );
}

/** The success view: when, how to join, add to calendar, and where to find it again. */
function BookingConfirmation({ booking, zone }: { booking: BookingView; zone: string }) {
  const t = useT();
  const intl = useIntlTag();
  return (
    <div role="status" className="flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-success-light text-success">
          <Icon name="check" size={20} />
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="text-md font-medium text-ink">{formatLongDay(booking.startsAt, zone, intl)}</p>
          <p className="text-sm text-body tabular-nums">{formatRange(booking.startsAt, booking.endsAt, zone, intl)}</p>
          <p className="text-sm text-secondary">
            {t("{service} with {name}", { service: booking.service.title, name: hostName(booking.host) })}
          </p>
        </div>
      </div>
      <ConsultationFacts durationMinutes={booking.service.durationMinutes} mode={booking.service.mode} locationHint={booking.locationHint} />
      {booking.meetingDetails ? (
        <div className="flex flex-col gap-1.5">
          <p className="text-sm font-medium text-ink">How to join</p>
          <MeetingDetails value={booking.meetingDetails} />
        </div>
      ) : null}
      <p className="text-sm text-secondary">We remind you a day and an hour before. You can find it, or cancel it, in Bookings.</p>
      <div className="flex flex-wrap gap-2">
        <a href={`/api/v1/bookings/${booking.id}/calendar.ics`} download className={buttonClasses({ variant: "secondary", size: "small" })}>
          <Icon name="calendar" size={16} />
          Add to calendar
        </a>
        <Link href="/bookings" className={buttonClasses({ variant: "ghost", size: "small" })}>
          See your bookings
          <Icon name="chevron-right" size={16} className="rtl:rotate-180" />
        </Link>
      </div>
    </div>
  );
}
