"use client";

import type { AnnouncementStatus } from "@chartermission/contracts";
import { Chip, Icon, cn } from "@chartermission/ui";
import { NoTranslate } from "@/i18n/auto";
import { useT } from "@/i18n/client";
import { STATUS_LABEL, STATUS_TONE, linkify, paragraphs } from "@/lib/messages";

export function StatusChip({ status, className }: { status: AnnouncementStatus; className?: string }) {
  return (
    <Chip tone={STATUS_TONE[status]} className={cn("gap-1 px-2! py-0.5! text-xs!", className)}>
      {status === "sending" && <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-info" />}
      {STATUS_LABEL[status]}
    </Chip>
  );
}

/** Which channels a bulk message uses, as icons (with their names for screen readers and on hover). */
export function ChannelIcons({ channels }: { channels: { email: boolean; message: boolean; notification: boolean } }) {
  const t = useT();
  const items = [
    channels.email && { icon: "mail" as const, label: t("Email") },
    channels.message && { icon: "message" as const, label: t("Inbox message") },
    channels.notification && { icon: "bell" as const, label: t("Notification") },
  ].filter((x): x is { icon: "mail" | "message" | "bell"; label: string } => !!x);
  return (
    <span className="flex items-center gap-1.5 text-secondary">
      {items.map((item) => (
        <span key={item.icon} title={item.label} className="inline-flex">
          <Icon name={item.icon} size={16} label={item.label} />
        </span>
      ))}
    </span>
  );
}

/** Text with clickable links, exactly as written (never translated). */
export function Linkified({ text, linkClassName }: { text: string; linkClassName?: string }) {
  return (
    <NoTranslate>
      {linkify(text).map((part, i) =>
        part.kind === "link" ? (
          <a key={i} href={part.href} target="_blank" rel="noopener noreferrer" className={cn("break-all underline", linkClassName)}>
            {part.text}
          </a>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </NoTranslate>
  );
}

/** A bulk message's body: blank lines start a paragraph, single line breaks stay, links are clickable. */
export function MessageBody({ text, className, linkClassName }: { text: string; className?: string; linkClassName?: string }) {
  const list = paragraphs(text);
  return (
    <div className={cn("flex flex-col gap-3 break-words whitespace-pre-line", className)}>
      {list.map((p, i) => (
        <p key={i}>
          <Linkified text={p} linkClassName={linkClassName} />
        </p>
      ))}
    </div>
  );
}

/** A tile with a number, for counts. */
export function CountTile({ label, value, tone }: { label: string; value: number | string; tone?: "error" | "warning" }) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-1 rounded-card border px-4 py-3",
        tone === "error" ? "border-error/40 bg-error-light" : tone === "warning" ? "border-warning bg-warning-light" : "border-line bg-card",
      )}
    >
      <span className={cn("text-xs", tone === "error" ? "text-error" : tone === "warning" ? "text-warning" : "text-secondary")}>{label}</span>
      <span className="text-h2 text-ink tabular-nums">{value}</span>
    </div>
  );
}
