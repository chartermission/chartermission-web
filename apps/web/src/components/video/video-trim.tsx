"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { formatDuration } from "@chartermission/contracts";
import { Button, Icon, cn } from "@chartermission/ui";
import { Dialog, closeDialog } from "@/components/social/dialog";
import { useT } from "@/i18n/client";

export type VideoTrim = { startMs: number; endMs: number };
/** `trim: null` posts the whole video; `cancelled` means the member backed out. */
export type TrimResult = { cancelled: true } | { cancelled: false; trim: VideoTrim | null };

type Request = { file: File; duration: number; maxSeconds: number; resolve: (result: TrimResult) => void };

let open: ((request: Request) => void) | null = null;

/**
 * Ask the member which part of a video to post. Opens the trim window (when <VideoTrimHost /> is
 * mounted) and resolves with their choice. The window always opens for videos the browser can
 * read, like the one in messaging apps: a video within the limit starts fully selected, a longer
 * one starts with its first `maxSeconds` selected.
 */
export function requestVideoTrim(file: File, duration: number, maxSeconds: number): Promise<TrimResult> {
  return new Promise((resolve) => {
    if (!open) resolve({ cancelled: false, trim: null });
    else open({ file, duration, maxSeconds, resolve });
  });
}

/** Mounted once per layout; shows the trim window on request. */
export function VideoTrimHost() {
  const [request, setRequest] = useState<Request | null>(null);
  useEffect(() => {
    open = setRequest;
    return () => {
      open = null;
    };
  }, []);
  if (!request) return null;
  return (
    <TrimDialog
      key={`${request.file.name}-${request.file.size}-${request.file.lastModified}`}
      request={request}
      onDone={(result) => {
        request.resolve(result);
        setRequest(null);
      }}
    />
  );
}

const MIN_SECONDS = 1;
const FRAMES = 10;

function TrimDialog({ request, onDone }: { request: Request; onDone: (result: TrimResult) => void }) {
  const t = useT();
  const { file, duration, maxSeconds } = request;
  const limit = Math.min(maxSeconds, duration);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(limit);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [frames, setFrames] = useState<string[]>([]);
  const [url] = useState(() => URL.createObjectURL(file));
  const video = useRef<HTMLVideoElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const done = useRef(false);
  const range = useRef({ start: 0, end: limit });
  useEffect(() => {
    range.current = { start, end };
  }, [start, end]);

  useEffect(() => () => URL.revokeObjectURL(url), [url]);

  // A strip of stills along the timeline. Decorative: if the browser can't decode frames, the bar stays plain.
  useEffect(() => {
    let live = true;
    const probe = document.createElement("video");
    probe.muted = true;
    probe.preload = "auto";
    probe.playsInline = true;
    probe.src = url;
    const canvas = document.createElement("canvas");
    const out: string[] = [];
    const grab = (index: number) => {
      if (!live || index >= FRAMES) return;
      probe.currentTime = Math.min(duration - 0.05, ((index + 0.5) / FRAMES) * duration);
    };
    probe.onloadeddata = () => {
      const h = 96;
      canvas.height = h;
      canvas.width = Math.max(1, Math.round((probe.videoWidth / Math.max(1, probe.videoHeight)) * h));
      grab(0);
    };
    probe.onseeked = () => {
      if (!live) return;
      try {
        canvas.getContext("2d")?.drawImage(probe, 0, 0, canvas.width, canvas.height);
        out.push(canvas.toDataURL("image/jpeg", 0.6));
        setFrames([...out]);
        grab(out.length);
      } catch {
        live = false;
      }
    };
    return () => {
      live = false;
      probe.removeAttribute("src");
      probe.load();
    };
  }, [url, duration]);

  const seek = useCallback((seconds: number) => {
    const el = video.current;
    if (el) el.currentTime = seconds;
    setPosition(seconds);
  }, []);

  /** Keep the selection inside the video, at least a second long and no longer than the limit. */
  const select = useCallback(
    (nextStart: number, nextEnd: number, moved: "start" | "end" | "both") => {
      let s = nextStart;
      let e = nextEnd;
      if (moved === "both") {
        const length = range.current.end - range.current.start;
        s = Math.min(Math.max(0, s), duration - length);
        e = s + length;
      } else if (moved === "start") {
        s = Math.min(Math.max(0, s), e - MIN_SECONDS);
        if (e - s > limit) e = s + limit;
      } else {
        e = Math.max(Math.min(duration, e), s + MIN_SECONDS);
        if (e - s > limit) s = e - limit;
      }
      setStart(s);
      setEnd(e);
      seek(moved === "end" ? e : s);
    },
    [duration, limit, seek],
  );

  function drag(handle: "start" | "end" | "both", event: ReactPointerEvent<HTMLElement>) {
    const el = track.current;
    if (!el) return;
    event.preventDefault();
    video.current?.pause();
    const rect = el.getBoundingClientRect();
    const at = (clientX: number) => (Math.min(Math.max(clientX - rect.left, 0), rect.width) / rect.width) * duration;
    const origin = at(event.clientX);
    const from = { ...range.current };
    const move = (e: PointerEvent) => {
      const now = at(e.clientX);
      if (handle === "start") select(now, range.current.end, "start");
      else if (handle === "end") select(range.current.start, now, "end");
      else select(from.start + (now - origin), from.end + (now - origin), "both");
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  function onHandleKey(handle: "start" | "end", event: KeyboardEvent<HTMLElement>) {
    const step = event.shiftKey ? 5 : 1;
    const delta = event.key === "ArrowLeft" || event.key === "ArrowDown" ? -step : event.key === "ArrowRight" || event.key === "ArrowUp" ? step : 0;
    if (!delta) return;
    event.preventDefault();
    if (handle === "start") select(start + delta, end, "start");
    else select(start, end + delta, "end");
  }

  function toggle() {
    const el = video.current;
    if (!el) return;
    if (el.paused) {
      if (el.currentTime < start || el.currentTime >= end - 0.05) el.currentTime = start;
      void el.play().catch(() => undefined);
    } else el.pause();
  }

  function finish(result: TrimResult, from: HTMLElement | null) {
    done.current = true;
    onDone(result);
    closeDialog(from);
  }

  const selected = end - start;
  const whole = start < 0.05 && end > duration - 0.05;
  const pct = (seconds: number) => `${(seconds / duration) * 100}%`;
  const tooLong = duration > maxSeconds + 0.5;

  return (
    <Dialog
      title={t("trim.title")}
      description={tooLong ? t("trim.descriptionLong", { max: formatDuration(maxSeconds) }) : t("trim.description")}
      onClose={() => {
        if (!done.current) onDone({ cancelled: true });
      }}
      width={640}
      footer={
        <>
          <Button variant="secondary" onClick={(event) => finish({ cancelled: true }, event.currentTarget)}>
            {t("common.cancel")}
          </Button>
          <Button
            onClick={(event) =>
              finish({ cancelled: false, trim: whole ? null : { startMs: Math.round(start * 1000), endMs: Math.round(end * 1000) } }, event.currentTarget)
            }
          >
            {whole ? t("trim.useWhole") : t("trim.usePart", { length: formatDuration(selected) })}
          </Button>
        </>
      }
    >
      <div className="relative overflow-hidden rounded-lg bg-black" dir="ltr">
        {/* The member's own file, playing locally before upload: there are no captions to offer yet. */}
        <video
          ref={video}
          src={url}
          playsInline
          preload="metadata"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onTimeUpdate={(event) => {
            const now = event.currentTarget.currentTime;
            setPosition(now);
            // Play only the selected part, in a loop.
            if (!event.currentTarget.paused && now >= range.current.end) event.currentTarget.currentTime = range.current.start;
          }}
          onClick={toggle}
          className="mx-auto max-h-[46dvh] w-full cursor-pointer object-contain"
        />
        <button
          type="button"
          onClick={toggle}
          aria-label={playing ? t("trim.pause") : t("trim.play")}
          className={cn(
            "absolute top-1/2 left-1/2 flex size-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white outline-none transition-opacity focus-visible:ring-2 focus-visible:ring-white",
            playing && "opacity-0 hover:opacity-100 focus-visible:opacity-100",
          )}
        >
          <Icon name={playing ? "pause" : "play"} size={26} />
        </button>
      </div>

      <div className="flex flex-col gap-2" dir="ltr">
        <div ref={track} className="relative h-14 touch-none rounded-lg bg-muted select-none">
          <div className="absolute inset-0 flex overflow-hidden rounded-lg" aria-hidden>
            {frames.map((src, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={i} src={src} alt="" draggable={false} className="h-full min-w-0 flex-1 object-cover" />
            ))}
          </div>
          {/* What is left out, dimmed on either side of the selection. */}
          <div aria-hidden className="absolute inset-y-0 left-0 rounded-l-lg bg-black/60" style={{ width: pct(start) }} />
          <div aria-hidden className="absolute inset-y-0 right-0 rounded-r-lg bg-black/60" style={{ width: pct(duration - end) }} />
          {/* Playhead */}
          {position >= start && position <= end && <div aria-hidden className="absolute inset-y-0 w-0.5 bg-white shadow" style={{ left: pct(position) }} />}
          {/* The selection: drag its middle to slide it, its edges to resize it. */}
          <div
            className="absolute inset-y-0 cursor-grab rounded-md border-y-[3px] border-warning active:cursor-grabbing"
            style={{ left: pct(start), width: pct(selected) }}
            onPointerDown={(event) => drag("both", event)}
          >
            {(["start", "end"] as const).map((handle) => (
              <div
                key={handle}
                role="slider"
                tabIndex={0}
                aria-label={handle === "start" ? t("trim.startHandle") : t("trim.endHandle")}
                aria-valuemin={0}
                aria-valuemax={Math.round(duration)}
                aria-valuenow={Math.round(handle === "start" ? start : end)}
                aria-valuetext={formatDuration(handle === "start" ? start : end)}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  drag(handle, event);
                }}
                onKeyDown={(event) => onHandleKey(handle, event)}
                className={cn(
                  "absolute inset-y-[-3px] flex w-4 cursor-ew-resize items-center justify-center bg-warning outline-none focus-visible:ring-2 focus-visible:ring-primary-light",
                  handle === "start" ? "left-0 -translate-x-1/2 rounded-l-md" : "right-0 translate-x-1/2 rounded-r-md",
                )}
              >
                <span aria-hidden className="h-5 w-0.5 rounded bg-white/90" />
              </div>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-secondary tabular-nums">
          <span>
            {formatDuration(start)} – {formatDuration(end)}
          </span>
          <span className={cn("font-medium", selected > maxSeconds + 0.5 ? "text-error" : "text-ink")} aria-live="polite">
            {t("trim.selected", { length: formatDuration(selected), max: formatDuration(maxSeconds) })}
          </span>
          <span>{t("trim.total", { length: formatDuration(duration) })}</span>
        </div>
      </div>
    </Dialog>
  );
}
