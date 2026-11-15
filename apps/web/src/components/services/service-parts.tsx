"use client";

import Link from "next/link";
import { CONSULTATION_MODE_LABELS, type ConsultationMode, type ServiceHost } from "@chartermission/contracts";
import { Icon, cn } from "@chartermission/ui";
import { PageLogo } from "@/components/pages/page-logo";
import { MemberAvatar } from "@/components/social/post-parts";
import { NoTranslate } from "@/i18n/auto";
import { useT } from "@/i18n/client";
import { durationLabel, hostHref, hostName, isUrl, modeIcon } from "./format";

/** The link, number or address for a consultation. Links open in a new tab. */
export function MeetingDetails({ value, className }: { value: string; className?: string }) {
  const trimmed = value.trim();
  return (
    <div className={cn("flex items-start gap-2 rounded-lg bg-success-light px-3 py-2.5 text-sm text-ink", className)}>
      <Icon name={isUrl(trimmed) ? "link" : "info"} size={16} className="mt-0.5 shrink-0 text-success" />
      <NoTranslate>
        {isUrl(trimmed) ? (
          <a href={trimmed} target="_blank" rel="noopener noreferrer nofollow" className="min-w-0 break-all font-medium text-primary-light hover:underline">
            {trimmed}
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        ) : (
          <p dir="auto" className="min-w-0 whitespace-pre-line break-words">
            {trimmed}
          </p>
        )}
      </NoTranslate>
    </div>
  );
}

/** "30 min · Video call · Google Meet" */
export function ConsultationFacts({
  durationMinutes,
  mode,
  locationHint,
  className,
}: {
  durationMinutes: number | null;
  mode: ConsultationMode | null;
  locationHint: string | null;
  className?: string;
}) {
  const t = useT();
  return (
    <ul className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-secondary", className)}>
      {durationMinutes != null && (
        <li className="flex items-center gap-1.5">
          <Icon name="clock" size={15} className="shrink-0" />
          {durationLabel(t, durationMinutes)}
        </li>
      )}
      {mode && (
        <li className="flex items-center gap-1.5">
          <Icon name={modeIcon[mode]} size={15} className="shrink-0" />
          {CONSULTATION_MODE_LABELS[mode]}
        </li>
      )}
      {locationHint && (
        <li className="flex min-w-0 items-center gap-1.5">
          <Icon name="pin" size={15} className="shrink-0" />
          <NoTranslate>
            <span dir="auto" className="truncate">
              {locationHint}
            </span>
          </NoTranslate>
        </li>
      )}
    </ul>
  );
}

/** Photo (member) or logo (page) with the host's name, linking to them. */
export function HostIdentity({ host, size = 40, subtitle = true, className }: { host: ServiceHost; size?: 32 | 40 | 56; subtitle?: boolean; className?: string }) {
  const name = hostName(host);
  const line = host.type === "page" ? host.page.tagline : host.member.headline;
  const verified = host.type === "page" ? host.page.verified : host.member.verified;
  return (
    <div className={cn("flex min-w-0 items-center gap-3", className)}>
      {host.type === "page" ? <PageLogo name={host.page.name} src={host.page.logoUrl} size={size} /> : <MemberAvatar member={host.member} size={size} link />}
      <div className="flex min-w-0 flex-col">
        <span className="flex min-w-0 items-center gap-1">
          <Link href={hostHref(host)} className="truncate text-md font-medium text-ink hover:underline">
            <NoTranslate>{name}</NoTranslate>
          </Link>
          {verified && <Icon name="verified" size={16} className="shrink-0 text-primary" label="Verified" />}
        </span>
        {subtitle && line && (
          <NoTranslate>
            <span dir="auto" className="truncate text-sm text-secondary">
              {line}
            </span>
          </NoTranslate>
        )}
      </div>
    </div>
  );
}
