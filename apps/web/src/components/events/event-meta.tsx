"use client";

import Link from "next/link";
import { EVENT_FORMAT_LABELS, type EventFormat, type EventHost, type EventStatus, type EventSummary } from "@chartermission/contracts";
import { Avatar, Chip, Icon, cn, type ChipTone } from "@chartermission/ui";
import { memberHref } from "@/components/social/links";
import { badgeParts, dayKey, formatClock, formatDay, sameWallClock, zoneAbbreviation, zoneCity } from "./time";
import { useViewerZone } from "./use-viewer-zone";

/* Shared bits of event UI: time in two zones, date badges, format/status chips, host line. */

/** Online and hybrid = info, in person = success (Figma Events screen). */
export const formatTone: Record<EventFormat, ChipTone> = { online: "info", in_person: "success", hybrid: "info" };

export function FormatChip({ format, className }: { format: EventFormat; className?: string }) {
  return (
    <Chip tone={formatTone[format]} className={cn("gap-1.5", className)}>
      <Icon name={format === "online" ? "video" : format === "hybrid" ? "globe" : "map-pin"} size={14} />
      {EVENT_FORMAT_LABELS[format]}
    </Chip>
  );
}

export const eventHref = (event: Pick<EventSummary, "slug">) => `/events/${event.slug}`;

/** The event's own time, then the viewer's when the clocks differ. */
export function useEventTimes(startsAt: string, timezone: string) {
  const viewer = useViewerZone();
  const event = `${formatClock(startsAt, timezone)} ${zoneAbbreviation(timezone, startsAt)}`;
  if (!viewer || sameWallClock(viewer, timezone, startsAt)) return { event, local: null, viewer };
  const shiftedDay = dayKey(startsAt, viewer) !== dayKey(startsAt, timezone);
  const local = `${shiftedDay ? `${formatDay(startsAt, viewer)}, ` : ""}${formatClock(startsAt, viewer)} your time`;
  return { event, local, viewer };
}

/** "Sat 21 Nov · 14:00 GMT · 18:00 your time" */
export function EventWhen({
  startsAt,
  timezone,
  withDay = true,
  stacked = false,
  className,
  localClassName = "text-secondary",
}: {
  startsAt: string;
  timezone: string;
  withDay?: boolean;
  /** Put "21:00 your time" on its own line (narrow cards). */
  stacked?: boolean;
  className?: string;
  localClassName?: string;
}) {
  const { event, local } = useEventTimes(startsAt, timezone);
  return (
    <time dateTime={startsAt} className={className} title={`${zoneCity(timezone)} time`}>
      {withDay && `${formatDay(startsAt, timezone)} · `}
      {event}
      {local && (stacked ? <span className={cn("block", localClassName)}>{local}</span> : <span className={localClassName}> · {local}</span>)}
    </time>
  );
}

/** Month + day badge in the viewer's zone (event zone until the browser's is known). */
export function EventDateBadge({
  startsAt,
  timezone,
  size = "default",
  tone = "card",
  className,
}: {
  startsAt: string;
  timezone: string;
  size?: "default" | "small" | "large";
  /** card: white badge on navy covers; accent: pale orange (right rail). */
  tone?: "card" | "accent";
  className?: string;
}) {
  const zone = useViewerZone() ?? timezone;
  const badge = badgeParts(startsAt, zone);
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex shrink-0 flex-col items-center font-semibold",
        tone === "card" ? "bg-card" : "bg-accent-light",
        size === "large" ? "rounded-card px-6 py-4" : "rounded-lg px-2.5 py-1.5",
        className,
      )}
    >
      <span className={cn("text-label", tone === "card" ? "text-accent" : "text-accent-hover")}>{badge.month}</span>
      <span className={cn("text-ink", size === "large" ? "text-display" : size === "small" ? "text-h3" : "text-h2")}>
        {size === "large" ? Number(badge.day) : badge.day}
      </span>
      {size === "large" && <span className="text-xs font-normal text-secondary">{badge.weekday}</span>}
    </span>
  );
}

export function hostName(host: EventHost): string {
  return host.type === "member" ? host.member.name : host.type === "chapter" ? host.chapter.name : host.organisation.name;
}

export function hostHref(host: EventHost): string | null {
  if (host.type === "member") return memberHref(host.member.handle);
  if (host.type === "chapter") return `/chapters/${host.chapter.slug}`;
  return null;
}

/** Small avatar (member photo, chapter/organisation initials) + "Hosted by …". */
export function HostLine({ host, size = 24, prefix = "Hosted by", className, link = true }: { host: EventHost; size?: 24 | 32 | 40; prefix?: string; className?: string; link?: boolean }) {
  const name = hostName(host);
  const href = link ? hostHref(host) : null;
  const avatar =
    host.type === "member" ? (
      <Avatar name={name} src={host.member.avatarUrl ?? undefined} tone={host.member.tone} size={size} />
    ) : host.type === "chapter" ? (
      <span className={cn("flex shrink-0 items-center justify-center rounded-full bg-accent-light text-accent-hover", size === 24 ? "size-6" : size === 32 ? "size-8" : "size-10")}>
        <Icon name="building" size={size === 24 ? 14 : 18} />
      </span>
    ) : (
      <Avatar name={name} src={host.organisation.logoUrl ?? undefined} size={size} />
    );
  return (
    <span className={cn("flex min-w-0 items-center gap-2 text-sm text-secondary", className)}>
      {avatar}
      <span className="min-w-0 truncate">
        {prefix}{" "}
        {href ? (
          <Link href={href} className="relative z-10 font-medium text-ink hover:underline">
            {name}
          </Link>
        ) : (
          <span className="font-medium text-ink">{name}</span>
        )}
      </span>
    </span>
  );
}

/** The viewer's own registration, as a chip: Registered, Waitlisted #2, Attended. */
export function ViewerStatusChip({ event, className }: { event: Pick<EventSummary, "viewer" | "past" | "cancelledAt">; className?: string }) {
  const { status, waitlistPosition } = event.viewer;
  if (event.cancelledAt && (status === "registered" || status === "waitlisted")) return null;
  if (status === "registered")
    return (
      <Chip tone="success" className={cn("gap-1", className)}>
        <Icon name="check" size={14} />
        {event.past ? "You registered" : "Registered"}
      </Chip>
    );
  if (status === "waitlisted")
    return (
      <Chip tone="warning" className={cn("gap-1", className)}>
        <Icon name="clock" size={14} />
        Waitlisted{waitlistPosition ? ` #${waitlistPosition}` : ""}
      </Chip>
    );
  if (status === "attended")
    return (
      <Chip tone="success" className={cn("gap-1", className)}>
        <Icon name="verified" size={14} />
        Attended
      </Chip>
    );
  return null;
}

const statusMeta: Record<EventStatus, { label: string; tone: ChipTone }> = {
  draft: { label: "Draft", tone: "neutral" },
  pending_review: { label: "In review", tone: "info" },
  changes_requested: { label: "Changes requested", tone: "warning" },
  published: { label: "Published", tone: "success" },
  rejected: { label: "Not approved", tone: "error" },
  unpublished: { label: "Unpublished", tone: "neutral" },
  archived: { label: "Ended", tone: "neutral" },
};

/** Lifecycle chip for hosts (drafts, review states). */
export function LifecycleChip({ status, className }: { status: EventStatus; className?: string }) {
  const meta = statusMeta[status];
  return (
    <Chip tone={meta.tone} className={className}>
      {meta.label}
    </Chip>
  );
}

export type Availability = { label: string; tone: "neutral" | "success" | "warning" | "error"; icon: "users" | "alert" | "clock" | "check" | "x" };

/** One line about the seats: "12 spots left", "Full — join waitlist", "Registration closed"… */
export function availability(event: EventSummary): Availability | null {
  if (event.cancelledAt) return { label: "Cancelled", tone: "error", icon: "x" };
  if (event.past) return { label: "This event has ended", tone: "neutral", icon: "check" };
  if (event.status !== "published" && event.status !== "archived") return null;
  if (event.registrationMode === "external") {
    return event.registrationOpen ? { label: "Registration on the host’s site", tone: "neutral", icon: "users" } : { label: "Registration closed", tone: "neutral", icon: "clock" };
  }
  const full = event.spotsLeft === 0;
  if (!event.registrationOpen) return { label: full ? "Full" : "Registration closed", tone: "neutral", icon: "clock" };
  if (full) return { label: "Full — join waitlist", tone: "warning", icon: "clock" };
  if (event.spotsLeft !== null) {
    return { label: `${event.spotsLeft} ${event.spotsLeft === 1 ? "spot" : "spots"} left`, tone: event.spotsLeft <= 10 ? "warning" : "neutral", icon: "users" };
  }
  return { label: "Open to all", tone: "neutral", icon: "users" };
}

const availabilityText: Record<Availability["tone"], string> = {
  neutral: "text-secondary",
  success: "text-success",
  warning: "text-warning",
  error: "text-error",
};

export function AvailabilityNote({ event, className }: { event: EventSummary; className?: string }) {
  const a = availability(event);
  if (!a) return null;
  return (
    <span className={cn("flex items-center gap-1 text-xs font-medium", availabilityText[a.tone], className)}>
      <Icon name={a.icon} size={14} className="shrink-0" />
      {a.label}
    </span>
  );
}

/** "312 going" — attended counts once the event has ended. */
export function goingLabel(event: Pick<EventSummary, "registeredCount" | "past" | "registrationMode">): string | null {
  if (event.registrationMode === "external") return null;
  if (event.registeredCount === 0) return event.past ? null : "Be the first to register";
  return `${event.registeredCount.toLocaleString("en")} ${event.past ? "went" : "going"}`;
}

/** The card's button: what the viewer can do from a list. */
export function cardAction(event: EventSummary): { label: string; variant: "primary" | "secondary"; hash: string } {
  const status = event.viewer.status;
  if (event.cancelledAt || event.past || status === "registered" || status === "waitlisted" || status === "attended") {
    return { label: "View", variant: "secondary", hash: "" };
  }
  if (!event.registrationOpen) return { label: "View", variant: "secondary", hash: "" };
  if (event.registrationMode === "external") return { label: "Register", variant: "primary", hash: "#register" };
  if (event.spotsLeft === 0) return { label: "Join waitlist", variant: "primary", hash: "#register" };
  return { label: "Register", variant: "primary", hash: "#register" };
}
