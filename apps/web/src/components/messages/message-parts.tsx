"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { AttachmentView, MessageAttachment, MessageShare, MessageView } from "@chartermission/contracts";
import { Button, Icon, cn } from "@chartermission/ui";
import { Lightbox } from "@/components/gallery/lightbox";
import { LinkPreviewCard } from "@/components/social/post-parts";
import { useLocale, useT } from "@/i18n/client";
import { INTL_LOCALE } from "@/i18n/config";

const clock = (s: number) => {
  const t = Math.max(0, Math.round(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
};

const sizeLabel = (bytes: number | null) =>
  bytes === null ? "" : bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/** Photos (tap to open full screen) and documents (download). */
export function MessageAttachments({ attachments, mine }: { attachments: MessageAttachment[]; mine: boolean }) {
  const t = useT();
  const images = attachments.filter((a) => a.kind === "image");
  const docs = attachments.filter((a) => a.kind === "document");
  const [open, setOpen] = useState<number | null>(null);
  const asViews: AttachmentView[] = images.map((a) => ({
    id: a.id,
    kind: "image",
    url: a.url,
    name: a.name,
    mime: a.mime,
    sizeBytes: a.sizeBytes ?? 0,
    width: a.width,
    height: a.height,
    alt: null,
  }));
  return (
    <div className="flex flex-col gap-1.5">
      {images.length > 0 && (
        <div className={cn("grid gap-1 overflow-hidden rounded-xl", images.length === 1 ? "grid-cols-1" : "grid-cols-2")}>
          {images.slice(0, 4).map((image, index) => (
            <button
              key={image.id}
              type="button"
              onClick={() => setOpen(index)}
              aria-label={t("Open photo {n} of {count}", { n: index + 1, count: images.length })}
              className="relative block overflow-hidden bg-muted"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={image.url}
                alt=""
                loading="lazy"
                width={image.width ?? undefined}
                height={image.height ?? undefined}
                className={cn("block w-full object-cover", images.length === 1 ? "max-h-[320px]" : "aspect-square")}
              />
              {index === 3 && images.length > 4 && (
                <span className="absolute inset-0 flex items-center justify-center bg-black/50 text-lg font-semibold text-white">+{images.length - 4}</span>
              )}
            </button>
          ))}
        </div>
      )}
      {docs.map((doc) => (
        <a
          key={doc.id}
          href={doc.url}
          download={doc.name}
          className={cn(
            "flex items-center gap-2.5 rounded-xl px-3 py-2",
            mine ? "bg-white/15 text-inverse hover:bg-white/25" : "bg-card text-ink hover:bg-primary-tint-2",
          )}
        >
          <Icon name="file" size={22} className="shrink-0" />
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-medium">{doc.name}</span>
            <span className={cn("text-xs", mine ? "text-inverse/75" : "text-secondary")}>{sizeLabel(doc.sizeBytes)}</span>
          </span>
          <Icon name="download" size={16} className="ms-auto shrink-0" />
        </a>
      ))}
      {open !== null && <Lightbox images={asViews} index={open} onIndexChange={setOpen} onClose={() => setOpen(null)} />}
    </div>
  );
}

/** A voice note: play/pause, progress you can tap to seek, length, and playback speed. */
export function VoicePlayer({ attachment, mine }: { attachment: MessageAttachment; mine: boolean }) {
  const t = useT();
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [speed, setSpeed] = useState(1);
  const duration = attachment.durationSeconds ?? 0;

  useEffect(() => {
    const el = audio.current;
    if (!el) return;
    const onTime = () => setPosition(el.currentTime);
    const onEnd = () => {
      setPlaying(false);
      setPosition(0);
    };
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("ended", onEnd);
    el.addEventListener("pause", () => setPlaying(false));
    el.addEventListener("play", () => setPlaying(true));
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("ended", onEnd);
    };
  }, []);

  function toggle() {
    const el = audio.current;
    if (!el) return;
    if (el.paused) {
      // Only one voice note plays at a time.
      document.querySelectorAll("audio").forEach((other) => other !== el && other.pause());
      void el.play();
    } else el.pause();
  }

  function seek(fraction: number) {
    const el = audio.current;
    if (!el || !duration) return;
    el.currentTime = fraction * duration;
    setPosition(el.currentTime);
  }

  function cycleSpeed() {
    const next = speed === 1 ? 1.5 : speed === 1.5 ? 2 : 1;
    setSpeed(next);
    if (audio.current) audio.current.playbackRate = next;
  }

  const progress = duration ? Math.min(1, position / duration) : 0;
  return (
    <div className="flex w-[240px] max-w-full items-center gap-2.5">
      <audio ref={audio} src={attachment.url} preload="none" />
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? t("Pause voice message") : t("Play voice message")}
        className={cn("flex size-9 shrink-0 items-center justify-center rounded-full", mine ? "bg-white/20 text-inverse" : "bg-primary text-inverse")}
      >
        <Icon name={playing ? "pause" : "play"} size={16} />
      </button>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <input
          type="range"
          min={0}
          max={1000}
          value={Math.round(progress * 1000)}
          onChange={(event) => seek(Number(event.target.value) / 1000)}
          aria-label={t("Voice message position")}
          className={cn("h-1 w-full cursor-pointer", mine ? "accent-white" : "accent-[var(--color-primary)]")}
        />
        <span className={cn("text-[11px] tabular-nums", mine ? "text-inverse/80" : "text-secondary")}>
          {playing || position ? clock(position) : clock(duration)}
        </span>
      </div>
      <button
        type="button"
        onClick={cycleSpeed}
        aria-label={t("Playback speed {speed}×", { speed })}
        className={cn("shrink-0 rounded-full px-1.5 text-[11px] font-semibold", mine ? "bg-white/20 text-inverse" : "bg-card text-secondary")}
      >
        {speed}×
      </button>
    </div>
  );
}

/** A shared post, event, profile… as a card linking to it. */
export function ShareCard({ share, mine }: { share: MessageShare; mine: boolean }) {
  const t = useT();
  if (!share.available) {
    return (
      <p className={cn("rounded-xl px-3 py-2 text-sm italic", mine ? "bg-white/15 text-inverse/85" : "bg-card text-secondary")}>
        {t("This item is no longer available.")}
      </p>
    );
  }
  return (
    <Link
      href={share.path}
      className={cn("flex w-[280px] max-w-full flex-col overflow-hidden rounded-xl border", mine ? "border-white/25 bg-white/10 hover:bg-white/20" : "border-line bg-card hover:bg-primary-tint-2")}
    >
      {share.imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={share.imageUrl} alt="" loading="lazy" className="aspect-[1.91/1] w-full bg-muted object-cover" />
      )}
      <span className="flex flex-col gap-0.5 px-3 py-2">
        <span className={cn("text-[11px] font-semibold tracking-wide uppercase", mine ? "text-inverse/75" : "text-primary-light")}>{t(SHARE_LABELS[share.type])}</span>
        <span className={cn("line-clamp-2 text-sm font-medium", mine ? "text-inverse" : "text-ink")}>{share.title}</span>
        {share.description && <span className={cn("line-clamp-2 text-xs", mine ? "text-inverse/80" : "text-secondary")}>{share.description}</span>}
      </span>
    </Link>
  );
}

const SHARE_LABELS: Record<MessageShare["type"], string> = {
  post: "Post",
  article: "Article",
  event: "Event",
  opportunity: "Opportunity",
  member: "Profile",
  page: "Page",
  chapter: "Chapter",
};

/** A meeting invitation: when, how long, the call link, and accept / decline / cancel / add to calendar. */
export function MeetingCard({
  message,
  mine,
  respond,
}: {
  message: MessageView;
  mine: boolean;
  respond: (response: "accept" | "decline" | "cancel") => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  const meeting = message.meeting!;
  const start = new Date(meeting.startsAt);
  const when = start.toLocaleString(INTL_LOCALE[locale], { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const status: Record<typeof meeting.status, string> = {
    proposed: mine ? "Waiting for an answer" : "Proposed",
    accepted: "Accepted",
    declined: "Declined",
    cancelled: "Cancelled",
  };
  return (
    <div className={cn("flex w-[280px] max-w-full flex-col gap-2 rounded-xl border p-3", mine ? "border-white/25 bg-white/10" : "border-line bg-card")}>
      <p className={cn("flex items-center gap-1.5 text-[11px] font-semibold tracking-wide uppercase", mine ? "text-inverse/75" : "text-primary-light")}>
        <Icon name="calendar" size={14} />
        {t("Meeting")}
      </p>
      <p className={cn("text-sm font-semibold", mine ? "text-inverse" : "text-ink", meeting.status === "cancelled" && "line-through")}>{meeting.title}</p>
      <p className={cn("text-sm", mine ? "text-inverse/90" : "text-ink")}>
        {when} · {t("{count} min", { count: meeting.durationMinutes })}
      </p>
      {meeting.note && <p className={cn("text-xs whitespace-pre-wrap", mine ? "text-inverse/80" : "text-secondary")}>{meeting.note}</p>}
      <p className={cn("text-xs font-medium", mine ? "text-inverse/80" : "text-secondary")}>{t(status[meeting.status])}</p>
      {meeting.status !== "cancelled" && meeting.status !== "declined" && (
        <div className="flex flex-wrap gap-2">
          {meeting.link && (
            <a
              href={meeting.link}
              target="_blank"
              rel="noopener noreferrer"
              className={cn("rounded-md px-2.5 py-1 text-xs font-semibold", mine ? "bg-white text-primary" : "bg-primary text-inverse")}
            >
              {t("Join call")}
            </a>
          )}
          <a
            href={`/api/v1/messages/${message.id}/meeting.ics`}
            className={cn("rounded-md px-2.5 py-1 text-xs font-semibold", mine ? "bg-white/20 text-inverse" : "bg-muted text-ink")}
          >
            {t("Add to calendar")}
          </a>
        </div>
      )}
      {meeting.status === "proposed" && (
        <div className="flex gap-2">
          {mine ? (
            <Button size="small" variant="secondary" onClick={() => respond("cancel")}>
              {t("Cancel meeting")}
            </Button>
          ) : (
            <>
              <Button size="small" onClick={() => respond("accept")}>
                {t("Accept")}
              </Button>
              <Button size="small" variant="secondary" onClick={() => respond("decline")}>
                {t("Decline")}
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export { LinkPreviewCard };
