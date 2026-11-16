"use client";

import Link from "next/link";
import { useId, useState, type ReactNode } from "react";
import type { ServiceView } from "@chartermission/contracts";
import { Chip, Icon, buttonClasses, cn } from "@chartermission/ui";
import { EnquiryButton } from "@/components/pages/enquiry-dialog";
import { MessageMemberButton } from "@/components/network/message-member";
import { NoTranslate } from "@/i18n/auto";
import { usePathname, useT } from "@/i18n/client";
import { BookButton } from "./booking-dialog";
import { hostBookingsHref, serviceHref } from "./format";
import { ConsultationFacts } from "./service-parts";

/** Descriptions longer than this (or with several paragraphs) start clamped with "Show more". */
const CLAMP_CHARS = 240;
/** Skills shown on a compact card. */
const COMPACT_SKILLS = 3;

/**
 * One service: title, description (clamped, expandable), skills, rate note and, for consultations,
 * length, how you meet and a "Book" button. Page services that can't be booked offer "Enquire";
 * member services offer "Message". Managers get their menu in `menu` and see the upcoming bookings.
 */
export function ServiceCard({
  service,
  menu,
  signedIn = true,
  linkTitle = true,
  clamp = true,
  headingLevel = 3,
  bare = false,
  compact = false,
  className,
}: {
  service: ServiceView;
  /** The manager's menu (edit, hide, reorder, delete). */
  menu?: ReactNode;
  /** Visitors who aren't signed in are sent to sign in instead of messaging. */
  signedIn?: boolean;
  /** The title links to the service's own page. */
  linkTitle?: boolean;
  clamp?: boolean;
  headingLevel?: 1 | 2 | 3;
  /** No border or padding: when the card sits inside another panel (the service's own page). */
  bare?: boolean;
  /** Tighter card for a narrow side rail: smaller title and padding, the first few skills. */
  compact?: boolean;
  className?: string;
}) {
  const t = useT();
  const id = useId();
  const pathname = usePathname();
  const [expanded, setExpanded] = useState(false);
  const { viewer } = service;
  const long = service.description.length > CLAMP_CHARS || service.description.split("\n").filter(Boolean).length > 3;
  const clamped = clamp && long && !expanded;
  const Heading = `h${headingLevel}` as "h1" | "h2" | "h3";
  const titleText = <NoTranslate>{service.title}</NoTranslate>;
  const signIn = `/signin?next=${encodeURIComponent(pathname)}`;

  let action: ReactNode = null;
  if (viewer.canManage) {
    action = service.bookable ? (
      <Link href={hostBookingsHref(service.host)} className={buttonClasses({ variant: "ghost", size: "small" })}>
        <Icon name="calendar" size={16} />
        {typeof service.upcomingBookings === "number" ? t("Upcoming bookings: {count}", { count: service.upcomingBookings }) : t("Bookings")}
      </Link>
    ) : null;
  } else if (service.bookable && service.active) {
    action = viewer.canBook ? (
      <BookButton service={service} size="small" />
    ) : !signedIn ? (
      <Link href={signIn} className={buttonClasses({ variant: "accent", size: "small" })}>
        Sign in to book
      </Link>
    ) : viewer.cantBookReason ? (
      <p className="flex items-center gap-1.5 text-sm text-secondary">
        <Icon name="info" size={16} className="shrink-0" />
        {viewer.cantBookReason}
      </p>
    ) : null;
  } else if (!service.bookable) {
    if (!signedIn) {
      action = (
        <Link href={signIn} className={buttonClasses({ variant: "secondary", size: "small" })}>
          {service.host.type === "page" ? "Sign in to enquire" : "Sign in to message"}
        </Link>
      );
    } else if (service.host.type === "page") {
      action = <EnquiryButton page={service.host.page} about={{ type: "service", id: service.id, title: service.title }} label={t("Enquire")} />;
    } else {
      action = <MessageMemberButton memberId={service.host.member.id} name={service.host.member.name} size="small" />;
    }
  }

  return (
    <article aria-labelledby={`${id}-title`} className={cn("flex flex-col", compact ? "gap-2.5" : "gap-3", !bare && "rounded-[10px] border border-line", !bare && (compact ? "p-3.5" : "p-4"), !bare && (service.active ? "bg-card" : "border-dashed bg-surface"), className)}>
      <div className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            {service.bookable && <Chip tone="success">Free consultation</Chip>}
            {!service.active && (
              <Chip tone="warning">
                <Icon name="eye-off" size={14} className="me-1" />
                Hidden
              </Chip>
            )}
          </div>
          <Heading id={`${id}-title`} className={cn("text-ink", headingLevel === 1 ? "text-h1 max-sm:text-h2" : compact ? "break-words text-md font-semibold" : "text-h3")}>
            {linkTitle ? (
              <Link href={serviceHref(service.id)} className="hover:underline">
                {titleText}
              </Link>
            ) : (
              titleText
            )}
          </Heading>
          {service.bookable && <ConsultationFacts durationMinutes={service.durationMinutes} mode={service.mode} locationHint={service.locationHint} />}
        </div>
        {menu}
      </div>

      <div className="flex flex-col items-start gap-1">
        <NoTranslate>
          <p id={`${id}-description`} dir="auto" className={cn("whitespace-pre-line break-words text-sm text-body", clamped && "line-clamp-3")}>
            {service.description}
          </p>
        </NoTranslate>
        {clamp && long && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-controls={`${id}-description`}
            className="rounded-sm text-sm font-medium text-primary-light hover:underline"
          >
            {expanded ? "Show less" : "Show more"}
          </button>
        )}
      </div>

      {service.skills.length > 0 && (
        <ul aria-label="Skills" className="flex flex-wrap gap-1.5">
          {(compact ? service.skills.slice(0, COMPACT_SKILLS) : service.skills).map((skill) => (
            <li key={skill}>
              <Chip tone="filter" className={cn("py-1 text-xs", compact && "max-w-full truncate")}>
                <NoTranslate>{skill}</NoTranslate>
              </Chip>
            </li>
          ))}
          {compact && service.skills.length > COMPACT_SKILLS && (
            <li className="self-center text-xs text-secondary">{t("+{count} more", { count: service.skills.length - COMPACT_SKILLS })}</li>
          )}
        </ul>
      )}

      {service.rateNote && (
        <p className="flex items-start gap-1.5 text-sm text-secondary">
          <Icon name="info" size={16} className="mt-0.5 shrink-0" />
          <NoTranslate>
            <span dir="auto">{service.rateNote}</span>
          </NoTranslate>
        </p>
      )}

      {action && <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">{action}</div>}
      {viewer.canManage && service.bookable && !service.active && (
        <p className="text-xs text-secondary">Nobody else can see or book a hidden service.</p>
      )}
    </article>
  );
}
