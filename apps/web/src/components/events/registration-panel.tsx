"use client";

import { InviteDialog } from "@/components/invite/invite-dialog";
import { openSendInMessage } from "@/components/messages/share-dialog";
import { openShare } from "@/components/social/share-out";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import type { EventDetail, RegistrationResult } from "@chartermission/contracts";
import { Button, Icon, Panel, buttonClasses, cn } from "@chartermission/ui";
import { pop } from "@/components/motion";
import { ConfirmDialog } from "@/components/social/confirm-dialog";
import { ShareToFeedDialog, canShareToFeed } from "./share-to-feed-dialog";
import { toast } from "@/components/social/toast";
import { api } from "@/lib/api/client";
import { goingLabel } from "./event-meta";
import { WhenBlock } from "./event-sections";
import { formatClock, formatDay, zoneAbbreviation } from "./time";
import { useNow, useViewerZone } from "./use-viewer-zone";
import { T, useT, useIntlTag } from "@/i18n/client";

function hostSite(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "the host’s site";
  }
}

/** "Thu 20 Nov, 18:00" in the viewer's zone (event zone + abbreviation before hydration). */
function useLocalMoment() {
  const viewer = useViewerZone();
  const intl = useIntlTag();
  return (iso: string, fallbackZone: string) => {
    const zone = viewer ?? fallbackZone;
    return `${formatDay(iso, zone, { intl })}, ${formatClock(iso, zone)}${viewer ? "" : ` ${zoneAbbreviation(zone, iso)}`}`;
  };
}

function CapacityBar({ event }: { event: Pick<EventDetail, "capacity" | "registeredCount" | "waitlistCount" | "past" | "registrationMode" | "cancelledAt"> }) {
  const t = useT();
  if (event.registrationMode === "external" || event.cancelledAt) return null;
  const going = goingLabel(t, event);
  if (event.capacity === null || event.past) {
    return going ? (
      <p className="flex items-center gap-1.5 text-sm text-body">
        <Icon name="users" size={16} className="text-secondary" />
        {going}
        {event.past ? "" : " · no seat limit"}
      </p>
    ) : null;
  }
  const ratio = Math.min(1, event.registeredCount / event.capacity);
  const full = event.registeredCount >= event.capacity;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="font-medium text-ink">
          <T vars={{ count: event.registeredCount.toLocaleString("en"), count2: event.capacity.toLocaleString("en") }}>{"{count} / {count2} registered"}</T>
        </span>
        <span className={full ? "font-medium text-warning" : "text-secondary"}>
          {full ? "Full" : t("{count} left", { count: (event.capacity - event.registeredCount).toLocaleString("en") })}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label="Seats taken"
        aria-valuemin={0}
        aria-valuemax={event.capacity}
        aria-valuenow={event.registeredCount}
        className="h-2 overflow-hidden rounded-full bg-muted"
      >
        <span className={cn("block h-full rounded-full transition-[width] duration-500", full ? "bg-warning" : "bg-primary")} style={{ width: `${Math.max(ratio * 100, ratio > 0 ? 3 : 0)}%` }} />
      </div>
      {event.waitlistCount > 0 && (
        <p className="text-xs text-secondary">
          {event.waitlistCount} {event.waitlistCount === 1 ? "person" : "people"} on the waitlist
        </p>
      )}
    </div>
  );
}

function Notice({ tone, icon, title, children }: { tone: "success" | "warning" | "neutral" | "error" | "info"; icon: "check" | "clock" | "alert" | "x" | "calendar" | "verified"; title: string; children?: React.ReactNode }) {
  const tones = {
    success: "bg-success-light text-success",
    warning: "bg-warning-light text-warning",
    neutral: "bg-muted text-secondary",
    error: "bg-error-light text-error",
    info: "bg-info-light text-info",
  } as const;
  return (
    <div className="flex items-start gap-3 rounded-lg border border-line p-3.5">
      <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-full", tones[tone])}>
        <Icon name={icon} size={16} />
      </span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="text-sm font-semibold text-ink">{title}</p>
        {children && <div className="text-sm text-secondary">{children}</div>}
      </div>
    </div>
  );
}

/** Online join: the button only when the API returned joinUrl; otherwise when it will appear. */
function JoinBlock({ event, isIn }: { event: EventDetail; isIn: boolean }) {
  const moment = useLocalMoment();
  if (!event.online || event.past || event.cancelledAt) return null;
  if (event.online.joinUrl && !isIn && event.viewer.canManage) {
    return (
      <div className="flex flex-col gap-1.5">
        <a href={event.online.joinUrl} target="_blank" rel="noopener noreferrer" className={buttonClasses({ variant: "secondary", block: true })}>
          <Icon name="video" size={18} />
          Open the {event.online.platform} link
          <span className="sr-only">(opens in a new tab)</span>
        </a>
        <p className="text-xs text-secondary">You see the link as a host. Registered members see it from 24 hours before the start.</p>
      </div>
    );
  }
  if (event.online.joinUrl) {
    return (
      <a href={event.online.joinUrl} target="_blank" rel="noopener noreferrer" className={buttonClasses({ variant: "accent", block: true })}>
        <Icon name="video" size={18} />
        Join on {event.online.platform}
        <span className="sr-only">(opens in a new tab)</span>
      </a>
    );
  }
  if (!isIn) return null;
  return (
    <p className="flex items-start gap-2 rounded-lg bg-info-light/60 p-3 text-sm text-body">
      <Icon name="link" size={16} className="mt-0.5 shrink-0 text-info" />
      <span>
        The {event.online.platform} link appears here 24 hours before the start
        {event.online.joinAvailableAt && (
          <>
            {" "}
            — from <strong className="font-medium text-ink">{moment(event.online.joinAvailableAt, event.timezone)}</strong>
          </>
        )}
        .
      </span>
    </p>
  );
}

/**
 * The event page's sticky panel: when, seats, the viewer's registration and every
 * registration state (internal, waitlist, external, closed, ended, cancelled), plus
 * add to calendar, save and share.
 */
export function RegistrationPanel({ event: initial, inviterHandle }: { event: EventDetail; inviterHandle: string }) {
  const t = useT();
  const router = useRouter();
  const moment = useLocalMoment();
  const [event, setEvent] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [saved, setSaved] = useState(initial.viewer.saved);
  const [announcement, setAnnouncement] = useState("");
  const [inviting, setInviting] = useState(false);
  const [sharingToFeed, setSharingToFeed] = useState(false);
  const saveIcon = useRef<HTMLSpanElement>(null);
  const now = useNow();

  const status = event.viewer.status;
  const isIn = status === "registered" || status === "attended";
  const started = Date.parse(event.startsAt) <= now;
  const publicState = event.status === "published" || event.status === "archived";

  function apply(result: RegistrationResult) {
    setEvent((current) => ({ ...current, ...result.event, viewer: { ...result.event.viewer, status: result.status, waitlistPosition: result.waitlistPosition } }));
  }

  async function register() {
    setBusy(true);
    try {
      const result = await api<RegistrationResult>(`/events/${event.id}/registrations`, { method: "POST", body: {} });
      apply(result);
      const message =
        result.status === "waitlisted"
          ? (result.waitlistPosition ? t("You’re on the waitlist at #{position}. We’ll email you if a seat opens.", { position: result.waitlistPosition }) : t("You’re on the waitlist. We’ll email you if a seat opens."))
          : "You’re registered. We’ve emailed your confirmation with a calendar file.";
      toast.success(message);
      setAnnouncement(message);
      router.refresh();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  }

  async function cancelRegistration() {
    const result = await api<RegistrationResult>(`/events/${event.id}/registrations/me`, { method: "DELETE" });
    apply(result);
    const message = status === "waitlisted" ? "You’ve left the waitlist." : "Your registration is cancelled.";
    toast.success(message);
    setAnnouncement(message);
    router.refresh();
  }

  async function toggleSave() {
    const next = !saved;
    setSaved(next);
    if (next) pop(saveIcon.current, { scale: 1.25, duration: 380 });
    try {
      await api("/bookmarks", { method: next ? "PUT" : "DELETE", body: { targetType: "event", targetId: event.id } });
      toast.success(next ? "Saved to your bookmarks" : "Removed from your bookmarks");
    } catch (e) {
      setSaved(!next);
      toast.error(e);
    }
  }

  function share() {
    openShare({
      path: `/events/${event.slug}`,
      title: event.title,
      text: event.summary ? `${event.title}: ${event.summary}` : event.title,
      send: { type: "event", key: event.slug },
      invite: event.past || event.cancelledAt ? undefined : { event: event.slug },
      shareToFeed: canShareToFeed(event) ? () => setSharingToFeed(true) : undefined,
    });
  }

  let body: React.ReactNode;
  if (event.cancelledAt) {
    body = (
      <Notice tone="error" icon="x" title="This event was cancelled">
        {event.cancelReason ?? "The host called it off."}
      </Notice>
    );
  } else if (event.past) {
    body = (
      <Notice tone="neutral" icon="check" title="This event has ended">
        {status === "attended" ? "Thanks for coming — you’re marked as attended." : "The description, speakers and agenda stay here for reference."}
      </Notice>
    );
  } else if (!publicState) {
    body = (
      <Notice tone="info" icon="calendar" title="Not open for registration yet">
        Registration opens once the event is published.
      </Notice>
    );
  } else if (event.registrationMode === "external") {
    body = event.externalUrl && event.registrationOpen ? (
      <div className="flex flex-col gap-2">
        <a href={event.externalUrl} target="_blank" rel="noopener noreferrer" className={buttonClasses({ block: true })}>
          Register on {hostSite(event.externalUrl)}
          <Icon name="arrow-up-right" size={18} />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
        <p className="text-xs text-secondary">The host manages registration on their own site{event.deadline ? `, until ${moment(event.deadline, event.timezone)}` : ""}.</p>
      </div>
    ) : (
      <Notice tone="neutral" icon="clock" title="Registration closed">
        {event.deadline && Date.parse(event.deadline) < now ? t("Registration closed on {moment}.", { moment: moment(event.deadline, event.timezone) }) : "Registration for this event has closed."}
      </Notice>
    );
  } else if (status === "registered") {
    body = (
      <Notice tone="success" icon="check" title="You’re registered">
        We’ll remind you 24 hours and 1 hour before it starts.
      </Notice>
    );
  } else if (status === "waitlisted") {
    body = (
      <Notice tone="warning" icon="clock" title={t("You’re #{count} on the waitlist", { count: event.viewer.waitlistPosition ?? "?" })}>
        If a seat opens you’ll get it automatically, and we’ll email you.
      </Notice>
    );
  } else if (event.registrationOpen) {
    const full = event.spotsLeft === 0;
    body = (
      <div className="flex flex-col gap-2">
        <Button block onClick={register} disabled={busy} variant={full ? "secondary" : "primary"}>
          {busy ? "Working…" : full ? "Join the waitlist" : status === "cancelled" ? "Register again" : "Register"}
        </Button>
        <p className="text-xs text-secondary">
          {full
            ? (event.waitlistCount ? t("The event is full. {count} ahead of you — you’ll get a seat automatically if one opens.", { count: event.waitlistCount }) : t("The event is full. You’ll get a seat automatically if one opens."))
            : event.deadline
              ? t("Registration closes {moment}.", { moment: moment(event.deadline, event.timezone) })
              : "Free for members. You can cancel any time before the start."}
        </p>
      </div>
    );
  } else {
    const deadlinePassed = event.deadline && Date.parse(event.deadline) < now;
    body = (
      <Notice tone="neutral" icon="clock" title={started ? "Registration closed" : event.spotsLeft === 0 ? "This event is full" : "Registration closed"}>
        {started
          ? "The event has started."
          : deadlinePassed
            ? t("Registration closed on {moment}.", { moment: moment(event.deadline!, event.timezone) })
            : event.spotsLeft === 0
              ? "Every seat is taken and there’s no waitlist."
              : "Registration isn’t open for this event."}
      </Notice>
    );
  }

  const canCancel = (status === "registered" || status === "waitlisted") && !started && !event.cancelledAt;

  return (
    <Panel id="register" aria-labelledby="register-heading" className="flex scroll-mt-24 flex-col gap-4 p-5">
      <h2 id="register-heading" className="sr-only">
        Registration
      </h2>
      <WhenBlock event={event} />
      <CapacityBar event={event} />
      <div className="flex flex-col gap-3">
        {body}
        <JoinBlock event={event} isIn={isIn} />
        {canCancel && (
          <button type="button" onClick={() => setConfirming(true)} className="self-start text-sm font-medium text-secondary hover:text-error hover:underline">
            {status === "waitlisted" ? "Leave the waitlist" : "Cancel registration"}
          </button>
        )}
      </div>
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
      {publicState && (
      <div className="grid grid-cols-4 gap-2 border-t border-line pt-4">
        {event.past ? (
          <span className="flex flex-col items-center gap-1 rounded-lg px-2 py-2 text-center text-xs font-medium text-disabled" title="The event has ended">
            <Icon name="calendar" size={20} />
            Ended
          </span>
        ) : (
          <a href={`/api/v1/events/${event.id}.ics`} download className="flex flex-col items-center gap-1 rounded-lg px-2 py-2 text-center text-xs font-medium text-secondary hover:bg-muted hover:text-ink">
            <Icon name="calendar" size={20} />
            <span>
              <span className="sr-only">Add to </span>Calendar
            </span>
          </a>
        )}
        <button
          type="button"
          aria-pressed={saved}
          onClick={toggleSave}
          className={cn("flex flex-col items-center gap-1 rounded-lg px-2 py-2 text-center text-xs font-medium hover:bg-muted", saved ? "text-primary" : "text-secondary hover:text-ink")}
        >
          <span ref={saveIcon} className="flex">
            <Icon name="bookmark" size={20} fill={saved ? "currentColor" : "none"} />
          </span>
          {saved ? "Saved" : "Save"}
        </button>
        <button
          type="button"
          onClick={share}
          aria-label={t("Share this event")}
          className="flex w-full flex-col items-center gap-1 rounded-lg px-2 py-2 text-center text-xs font-medium text-secondary hover:bg-muted hover:text-ink"
        >
          <Icon name="share" size={20} />
          {t("Share")}
        </button>
        {event.past || event.cancelledAt ? (
          <button type="button" onClick={() => openSendInMessage({ type: "event", key: event.slug })} className="flex flex-col items-center gap-1 rounded-lg px-2 py-2 text-center text-xs font-medium text-secondary hover:bg-muted hover:text-ink">
            <Icon name="send" size={20} />
            Send
          </button>
        ) : (
          <button type="button" onClick={() => setInviting(true)} className="flex flex-col items-center gap-1 rounded-lg px-2 py-2 text-center text-xs font-medium text-secondary hover:bg-muted hover:text-ink">
            <Icon name="user-plus" size={20} />
            Invite
          </button>
        )}
      </div>
      )}
      {sharingToFeed && <ShareToFeedDialog event={event} onClose={() => setSharingToFeed(false)} />}
      {inviting && <InviteDialog inviterHandle={inviterHandle} event={{ slug: event.slug, title: event.title }} onClose={() => setInviting(false)} />}
      {confirming && (
        <ConfirmDialog
          title={status === "waitlisted" ? "Leave the waitlist?" : "Cancel your registration?"}
          confirmLabel={status === "waitlisted" ? "Leave waitlist" : "Cancel registration"}
          danger
          onConfirm={cancelRegistration}
          onClose={() => setConfirming(false)}
        >
          {status === "waitlisted"
            ? "You’ll lose your place in the queue. You can join again later if there’s still a waitlist."
            : event.waitlistCount > 0
              ? "Your seat goes to the first person on the waitlist. You can register again while seats or the waitlist are open."
              : "Your seat is released. You can register again while registration is open."}
        </ConfirmDialog>
      )}
    </Panel>
  );
}
