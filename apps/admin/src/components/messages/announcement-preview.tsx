"use client";

import { useState } from "react";
import type { MemberRef } from "@chartermission/contracts";
import { Avatar, Icon, LogoMark, SegmentedControl, cn } from "@chartermission/ui";
import { NoTranslate } from "@/i18n/auto";
import { useT } from "@/i18n/client";
import { MessageBody } from "./shared";

type Channel = "email" | "message" | "notification";

export type PreviewContent = {
  subject: string;
  body: string;
  linkUrl: string | null;
  linkLabel: string | null;
  channels: { email: boolean; message: boolean; notification: boolean };
  important: boolean;
};

/**
 * How the bulk message looks to members: the email (subject, paragraphs, button), the message in
 * their conversation with Charter Mission, and the notification. Close approximations, not the exact
 * templates.
 */
export function AnnouncementPreview({ content, sender, className }: { content: PreviewContent; sender: MemberRef | null; className?: string }) {
  const t = useT();
  const enabled = (["email", "message", "notification"] as const).filter((c) => content.channels[c]);
  const [picked, setPicked] = useState<Channel>("email");
  const channel = enabled.includes(picked) ? picked : enabled[0];
  const labels: Record<Channel, string> = { email: t("Email"), message: t("Message"), notification: t("Notification") };

  return (
    <section aria-labelledby="preview-title" className={cn("flex flex-col gap-3 rounded-card border border-line bg-card p-4", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="preview-title" className="text-h3 text-ink">
          Preview
        </h2>
        {enabled.length > 1 && channel && (
          <SegmentedControl label={t("Preview channel")} size="small" value={channel} onChange={setPicked} items={enabled.map((c) => ({ value: c, label: labels[c] }))} />
        )}
      </div>
      {!channel ? (
        <p className="text-sm text-secondary">Choose how to send it to see a preview.</p>
      ) : channel === "email" ? (
        <EmailPreview content={content} />
      ) : channel === "message" ? (
        <MessagePreview content={content} sender={sender} />
      ) : (
        <NotificationPreview content={content} sender={sender} />
      )}
    </section>
  );
}

function subjectOrPlaceholder(subject: string) {
  return subject.trim() || null;
}

function EmailPreview({ content }: { content: PreviewContent }) {
  const subject = subjectOrPlaceholder(content.subject);
  const label = content.linkLabel?.trim() || "Open link";
  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-line bg-surface text-sm">
      <div className="flex flex-col gap-0.5 border-b border-line bg-card px-3 py-2 text-xs text-secondary">
        <span>
          <span className="text-secondary">From: </span>
          <span className="text-ink">Charter Mission</span>
        </span>
        <span className="truncate">
          <span>Subject: </span>
          {subject ? (
            <NoTranslate>
              <span className="font-medium text-ink">{subject}</span>
            </NoTranslate>
          ) : (
            <span className="italic">No subject yet</span>
          )}
        </span>
      </div>
      <div className="flex flex-col gap-4 p-4">
        <span className="flex items-center gap-2 text-primary">
          <LogoMark size={24} />
          <span className="font-semibold">Charter Mission</span>
        </span>
        <div className="flex flex-col gap-4 rounded-lg bg-card p-4 text-body">
          {subject && (
            <NoTranslate>
              <h3 className="text-h3 break-words text-ink">{subject}</h3>
            </NoTranslate>
          )}
          {content.body.trim() ? <MessageBody text={content.body} linkClassName="text-primary" /> : <p className="text-secondary italic">Your message appears here.</p>}
          {content.linkUrl && (
            <span>
              <span className="inline-flex rounded-lg bg-primary px-4 py-2 text-sm font-medium text-inverse">
                <NoTranslate>{label}</NoTranslate>
              </span>
            </span>
          )}
        </div>
        <p className="text-xs text-secondary">
          {content.important
            ? "This is a service notice about your Charter Mission account, so it’s sent even if you turned off announcement emails."
            : "You’re getting this as a Charter Mission member. Unsubscribe from announcement emails."}
        </p>
      </div>
    </div>
  );
}

function SenderAvatar({ sender, size }: { sender: MemberRef | null; size: 32 | 40 }) {
  return sender ? (
    <Avatar name={sender.name} src={sender.avatarUrl ?? undefined} tone={sender.tone} size={size} />
  ) : (
    <LogoMark size={size} className="rounded-full" />
  );
}

function MessagePreview({ content, sender }: { content: PreviewContent; sender: MemberRef | null }) {
  const subject = subjectOrPlaceholder(content.subject);
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-3 text-sm">
      <div className="flex items-center gap-2 border-b border-line pb-2">
        <SenderAvatar sender={sender} size={32} />
        <span className="flex min-w-0 items-center gap-1 font-medium text-ink">
          <span className="truncate">{sender ? <NoTranslate>{sender.name}</NoTranslate> : "Charter Mission"}</span>
          <Icon name="verified" size={14} className="text-primary-light" />
        </span>
      </div>
      <div className="flex justify-start">
        <div className="flex max-w-[92%] flex-col gap-2 rounded-2xl rounded-ss-sm bg-card px-3 py-2 text-body shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
          {subject ? (
            <NoTranslate>
              <p className="font-semibold break-words text-ink">{subject}</p>
            </NoTranslate>
          ) : (
            <p className="text-secondary italic">No subject yet</p>
          )}
          {content.body.trim() && <MessageBody text={content.body} className="gap-2" linkClassName="text-primary" />}
          {content.linkUrl && (
            <a href={content.linkUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium break-all text-primary underline">
              <NoTranslate>{content.linkLabel?.trim() || content.linkUrl}</NoTranslate>
              <Icon name="external" size={12} />
            </a>
          )}
        </div>
      </div>
      <p className="text-xs text-secondary">Members can reply. Replies arrive in the Inbox here.</p>
    </div>
  );
}

function NotificationPreview({ content, sender }: { content: PreviewContent; sender: MemberRef | null }) {
  const subject = subjectOrPlaceholder(content.subject);
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-3 text-sm">
      <div className="flex items-start gap-3 rounded-lg bg-card p-3">
        <span className="relative">
          <SenderAvatar sender={sender} size={40} />
          <span className="absolute -end-1 -bottom-1 inline-flex size-5 items-center justify-center rounded-full border-2 border-card bg-primary text-inverse">
            <Icon name="bell" size={10} />
          </span>
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-body">
            <span className="font-medium text-ink">{sender ? <NoTranslate>{sender.name}</NoTranslate> : "Charter Mission"}</span>{" "}
            {subject ? <NoTranslate>{subject}</NoTranslate> : <span className="text-secondary italic">No subject yet</span>}
          </span>
          <span className="text-xs text-secondary">now</span>
        </span>
        <span aria-hidden className="mt-2 size-2 shrink-0 rounded-full bg-accent" />
      </div>
      <p className="text-xs text-secondary">{content.linkUrl ? "Tapping it opens the link." : "Tapping it opens the message."}</p>
    </div>
  );
}
