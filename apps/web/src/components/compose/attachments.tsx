"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ALT_TEXT_MAX_CHARS, POST_MAX_IMAGES, type AttachmentView, type DraftView, type MediaLayout, type UploadPurpose } from "@chartermission/contracts";
import { Icon, cn } from "@chartermission/ui";
import { UploadCancelled, chooseVideoPart, uploadFile } from "@/lib/upload";
import { getMediaLimits } from "@/lib/media-limits";
import { formatDuration, UPLOAD_LIMITS } from "@chartermission/contracts";
import { errorMessage } from "@/components/social/errors";
import { formatBytes } from "@/components/social/format";
import { T, useT } from "@/i18n/client";
import type { Translate } from "@/i18n/translate";
import { MediaLayoutPicker, MediaLayoutPreview } from "./media-layout";

export const MAX_IMAGES = POST_MAX_IMAGES;

export type Attachment = {
  key: string;
  name: string;
  size: number;
  purpose: Extract<UploadPurpose, "post_image" | "post_document" | "post_video">;
  previewUrl: string | null;
  progress: number;
  status: "uploading" | "scanning" | "ready" | "rejected";
  fileId: string | null;
  error: string | null;
  /** Image description for screen readers (alt text). */
  alt: string;
  /** Images picked in this session: their size in pixels once read, for the layout preview. */
  width: number | null;
  height: number | null;
};

let counter = 0;

/**
 * Up to MAX_IMAGES images, 1 video or 1 PDF (CM-FED-01). Each file goes through lib/upload.ts:
 * signed upload with progress, then the server-side validation and malware scan. The list keeps
 * the order files were added in, whichever upload finishes first, and the author can reorder it:
 * that order is the order the post shows them in.
 */
export function useAttachments(initial?: { files: DraftView["attachments"]; altTexts?: Record<string, string> }) {
  const t = useT();
  const [items, setItems] = useState<Attachment[]>(() =>
    (initial?.files ?? []).map((file) => ({
      key: `att-${++counter}`,
      name: file.name ?? (file.kind === "image" ? "Image" : file.kind === "video" ? "Video" : "Document"),
      size: 0,
      purpose: file.kind === "image" ? "post_image" : file.kind === "video" ? "post_video" : "post_document",
      previewUrl: file.kind === "image" ? file.url : null,
      progress: 1,
      status: "ready",
      fileId: file.id,
      error: null,
      alt: initial?.altTexts?.[file.id] ?? "",
      width: null,
      height: null,
    })),
  );
  const [notice, setNotice] = useState<string | null>(null);
  const urls = useRef(new Set<string>());

  useEffect(() => {
    const created = urls.current;
    return () => created.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  const patch = (key: string, change: Partial<Attachment>) =>
    setItems((current) => current.map((item) => (item.key === key ? { ...item, ...change } : item)));

  function add(files: File[], kind: "image" | "document" | "video", maxImages: number = MAX_IMAGES) {
    setNotice(null);
    const live = items.filter((item) => item.status !== "rejected");
    const hasDoc = live.some((item) => item.purpose === "post_document");
    const hasVideo = live.some((item) => item.purpose === "post_video");
    const imageCount = live.filter((item) => item.purpose === "post_image").length;
    let accepted: File[];
    if (kind === "video") {
      if (live.length > 0) {
        setNotice("A video goes in a post on its own. Remove the current files first.");
        return;
      }
      accepted = files.slice(0, 1);
    } else if (kind === "document") {
      if (imageCount > 0 || hasDoc || hasVideo) {
        setNotice(t("A post can have up to {max} images, 1 video or 1 PDF, one kind at a time. Remove the current files first.", { max: MAX_IMAGES }));
        return;
      }
      accepted = files.slice(0, 1);
    } else {
      if (hasDoc || hasVideo) {
        setNotice(
          hasDoc
            ? t("A post can have up to {max} images, 1 video or 1 PDF, one kind at a time. Remove the PDF first.", { max: MAX_IMAGES })
            : t("A post can have up to {max} images, 1 video or 1 PDF, one kind at a time. Remove the video first.", { max: MAX_IMAGES }),
        );
        return;
      }
      accepted = files.slice(0, Math.max(0, maxImages - imageCount));
      if (accepted.length < files.length) setNotice(maxImages === 1 ? "An article takes one cover image." : t("You can add up to {maxImages} images.", { maxImages }));
    }

    const next: Attachment[] = accepted.map((file) => {
      const previewable = (kind === "image" && file.type.startsWith("image/")) || (kind === "video" && file.type.startsWith("video/"));
      const previewUrl = previewable ? URL.createObjectURL(file) : null;
      if (previewUrl) urls.current.add(previewUrl);
      return {
        key: `att-${++counter}`,
        name: file.name,
        size: file.size,
        purpose: kind === "image" ? "post_image" : kind === "video" ? "post_video" : "post_document",
        previewUrl,
        progress: 0,
        status: "uploading",
        fileId: null,
        error: null,
        alt: "",
        width: null,
        height: null,
      };
    });
    setItems((current) => [...current, ...next]);
    // Read each picture's size so the layout preview can frame it the way the post will.
    for (const item of next) {
      if (item.purpose !== "post_image" || !item.previewUrl) continue;
      const probe = new window.Image();
      probe.onload = () => patch(item.key, { width: probe.naturalWidth || null, height: probe.naturalHeight || null });
      probe.src = item.previewUrl;
    }

    next.forEach((item, index) => {
      const file = accepted[index]!;
      // Videos first open the trim window, where the member picks the part to post.
      const part = item.purpose === "post_video" ? getMediaLimits().then((limits) => chooseVideoPart(file, limits.postVideoMaxSeconds)) : Promise.resolve(null);
      part
        .then((trim) =>
          uploadFile(file, item.purpose, (fraction) => patch(item.key, fraction >= 1 ? { progress: 1, status: "scanning" } : { progress: fraction }), trim),
        )
        .then((view) => patch(item.key, { status: "ready", fileId: view.id, progress: 1 }))
        .catch((e: unknown) => {
          // Closed the trim window without choosing: drop the file as if it was never picked.
          if (e instanceof UploadCancelled) remove(item.key);
          else patch(item.key, { status: "rejected", error: errorMessage(e) });
        });
    });
  }

  function setAlt(key: string, alt: string) {
    patch(key, { alt: alt.slice(0, ALT_TEXT_MAX_CHARS) });
  }

  /** Move a file one place earlier (-1) or later (+1) in the order. */
  function move(key: string, delta: -1 | 1) {
    setItems((current) => {
      const from = current.findIndex((item) => item.key === key);
      const to = from + delta;
      if (from < 0 || to < 0 || to >= current.length) return current;
      const next = [...current];
      [next[from], next[to]] = [next[to]!, next[from]!];
      return next;
    });
  }

  /** Put a file where another one is (drag and drop); the files in between shift along. */
  function moveTo(key: string, targetKey: string) {
    setItems((current) => {
      const from = current.findIndex((item) => item.key === key);
      const to = current.findIndex((item) => item.key === targetKey);
      if (from < 0 || to < 0 || from === to) return current;
      const next = [...current];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved!);
      return next;
    });
  }

  function remove(key: string) {
    setItems((current) => {
      const item = current.find((i) => i.key === key);
      if (item?.previewUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(item.previewUrl);
        urls.current.delete(item.previewUrl);
      }
      return current.filter((i) => i.key !== key);
    });
    setNotice(null);
  }

  const ready = items.filter((item) => item.status === "ready" && item.fileId);
  return {
    items,
    notice,
    add,
    remove,
    move,
    moveTo,
    setAlt,
    ids: ready.map((item) => item.fileId!),
    /** Ready files with their kind and description, for the post or draft payload. */
    ready: ready.map((item) => ({
      fileId: item.fileId!,
      kind: item.purpose === "post_image" ? ("image" as const) : item.purpose === "post_video" ? ("video" as const) : ("document" as const),
      alt: item.alt,
    })),
    busy: items.some((item) => item.status === "uploading" || item.status === "scanning"),
    rejected: items.some((item) => item.status === "rejected"),
    hasDocument: items.some((item) => item.purpose === "post_document" && item.status !== "rejected"),
    hasVideo: items.some((item) => item.purpose === "post_video" && item.status !== "rejected"),
  };
}

export type AttachmentsState = ReturnType<typeof useAttachments>;

function statusText(t: Translate, item: Attachment) {
  switch (item.status) {
    case "uploading":
      return t("Uploading {percent}%", { percent: Math.round(item.progress * 100) });
    case "scanning":
      return item.purpose === "post_video" ? "Processing video… longer videos can take a few minutes" : "Checking file…";
    case "ready":
      return "Ready";
    case "rejected":
      return item.error ?? "This file couldn’t be accepted";
  }
}

/** "Add description" (alt text) for one image, collapsed until asked for. */
function AltTextField({ item, onChange }: { item: Attachment; onChange: (alt: string) => void }) {
  const id = useId();
  const [open, setOpen] = useState(item.alt.length > 0);
  const inputRef = useRef<HTMLInputElement>(null);
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          requestAnimationFrame(() => inputRef.current?.focus());
        }}
        className="flex w-fit items-center gap-1 rounded-sm text-xs font-medium text-primary-light hover:underline"
      >
        <Icon name="plus" size={12} />
        Add description<span className="sr-only"> <T vars={{ name: item.name }}>{"for {name}"}</T></span>
      </button>
    );
  }
  const near = item.alt.length > ALT_TEXT_MAX_CHARS - 40;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium text-body">
        Description <span className="font-normal text-secondary">(alt text for people using screen readers)</span>
      </label>
      <div className="relative">
        <input
          ref={inputRef}
          id={id}
          value={item.alt}
          maxLength={ALT_TEXT_MAX_CHARS}
          onChange={(event) => onChange(event.target.value)}
          placeholder="e.g. Three founders cutting a ribbon outside a solar plant"
          aria-describedby={`${id}-count`}
          className="h-8 w-full rounded-md border border-line bg-card ps-2.5 pe-16 text-xs text-ink outline-none placeholder:text-disabled focus:border-primary-light focus:ring-2 focus:ring-primary-tint"
        />
        <span id={`${id}-count`} className={cn("pointer-events-none absolute end-2.5 inset-y-0 my-auto h-fit text-[11px]", near ? "text-warning" : "text-disabled")}>
          <span aria-hidden="true">
            {item.alt.length}/{ALT_TEXT_MAX_CHARS}
          </span>
          <span className="sr-only"><T vars={{ ALTTEXTMAXCHARS: ALT_TEXT_MAX_CHARS }}>{"Up to {ALTTEXTMAXCHARS} characters"}</T></span>
        </span>
      </div>
    </div>
  );
}

/** File chooser and the list of uploads with progress, scan state, alt text and remove. */
export function AttachmentPicker({
  state,
  id,
  mode,
  maxImages = MAX_IMAGES,
  variant = "attachments",
  layout,
  onLayoutChange,
}: {
  state: AttachmentsState;
  id: string;
  mode: "image" | "document" | "video";
  maxImages?: number;
  /** "cover": one article cover image. */
  variant?: "attachments" | "cover";
  /** With both set, two or more images get the layout choice and a preview of the post's photos. */
  layout?: MediaLayout;
  onLayoutChange?: (layout: MediaLayout) => void;
}) {
  const t = useT();
  const { items, notice, add, remove, move, moveTo, setAlt } = state;
  const liveImages = items.filter((i) => i.purpose === "post_image" && i.status !== "rejected");
  const images = liveImages.length;
  /** Several images: each shows its place in the order and can be moved. */
  const ordered = variant !== "cover" && images > 1;
  /** The arrow buttons by file and direction, to keep focus on a file as it moves. */
  const arrows = useRef(new Map<string, HTMLButtonElement | null>());
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropOn, setDropOn] = useState<string | null>(null);
  const previewImages: AttachmentView[] = liveImages
    .filter((item) => item.previewUrl)
    .map((item) => ({
      id: item.key,
      kind: "image",
      url: item.previewUrl!,
      name: item.name,
      mime: "image/*",
      sizeBytes: item.size,
      width: item.width,
      height: item.height,
      alt: item.alt.trim() || null,
    }));

  /** Move with the arrow buttons, keeping keyboard focus on the file that moved. */
  function shift(key: string, delta: -1 | 1) {
    move(key, delta);
    requestAnimationFrame(() => {
      const same = arrows.current.get(`${key}:${delta < 0 ? "earlier" : "later"}`);
      const other = arrows.current.get(`${key}:${delta < 0 ? "later" : "earlier"}`);
      (same && !same.disabled ? same : other)?.focus();
    });
  }
  const full =
    mode === "image"
      ? images >= maxImages
      : items.some((i) => i.purpose === (mode === "video" ? "post_video" : "post_document") && i.status !== "rejected");
  const cover = variant === "cover";
  const [maxSeconds, setMaxSeconds] = useState<number | null>(null);
  useEffect(() => {
    if (mode !== "video") return;
    let live = true;
    void getMediaLimits().then((l) => live && setMaxSeconds(l.postVideoMaxSeconds));
    return () => {
      live = false;
    };
  }, [mode]);
  const videoGb = (UPLOAD_LIMITS.post_video.maxBytes / 1024 / 1024 / 1024).toFixed(1);

  return (
    <div className="flex flex-col gap-3 rounded-card border border-dashed border-line-strong bg-surface p-4">
      {!full && (
        <label className="flex w-fit cursor-pointer items-center gap-2 rounded-md text-sm font-medium text-primary focus-within:ring-2 focus-within:ring-primary-light">
          <Icon
            name={mode === "image" ? "image" : mode === "video" ? "video" : "book"}
            size={18}
            className={mode === "image" ? "text-info" : mode === "video" ? "text-warning" : "text-error"}
          />
          {cover
            ? "Choose a cover image"
            : mode === "image"
              ? images
                ? "Add more images"
                : "Choose images to upload"
              : mode === "video"
                ? "Choose a video to upload"
                : "Choose a PDF to upload"}
          <input
            id={id}
            type="file"
            accept={mode === "image" ? "image/jpeg,image/png,image/webp" : mode === "video" ? "video/mp4,video/quicktime,video/webm" : "application/pdf"}
            multiple={mode === "image" && maxImages > 1}
            className="sr-only"
            onChange={(event) => {
              add(Array.from(event.target.files ?? []), mode, maxImages);
              event.target.value = "";
            }}
          />
        </label>
      )}
      {!(cover && full) && (
        <p className="text-xs text-secondary">
          {cover
            ? "Optional. One JPEG, PNG or WebP image, 5 MB max. Wide images (2:1) look best."
            : mode === "image"
              ? `${t("Up to {max} images. JPEG, PNG or WebP, 5 MB each.", { max: maxImages })}${ordered ? ` ${t("They show in the order below: drag a picture or use the arrows to change it.")}` : ""}`
              : mode === "video"
                ? `${t("One video: MP4, MOV or WebM, {size} GB max.", { size: videoGb })}${maxSeconds ? ` ${t("Posts show up to {duration}: if yours is longer, you choose which part to post.", { duration: formatDuration(maxSeconds) })}` : ""}`
                : "One PDF, up to 10 MB."}{" "}
          {!cover && "Files are checked for safety before anyone else sees them."}
        </p>
      )}
      {notice && (
        <p role="alert" className="text-xs text-warning">
          {notice}
        </p>
      )}
      {items.length > 0 && (
        <ul className="flex flex-col gap-2" aria-live="polite">
          {items.map((item, index) => {
            const place = ordered && item.purpose === "post_image" && item.status !== "rejected" ? liveImages.indexOf(item) + 1 : 0;
            return (
            <li
              key={item.key}
              onDragOver={(event) => {
                if (!dragging || dragging === item.key) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                if (dropOn !== item.key) setDropOn(item.key);
              }}
              onDrop={(event) => {
                if (!dragging) return;
                event.preventDefault();
                moveTo(dragging, item.key);
                setDragging(null);
                setDropOn(null);
              }}
              className={cn(
                "flex items-start gap-3 rounded-lg border bg-card p-2",
                dropOn === item.key && dragging !== item.key ? "border-primary-light ring-2 ring-primary-tint" : "border-line",
                dragging === item.key && "opacity-50",
              )}
            >
              {place > 0 ? (
                // The picture is the drag handle (the row holds a text field, which must stay selectable).
                <span
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", item.name);
                    setDragging(item.key);
                  }}
                  onDragEnd={() => {
                    setDragging(null);
                    setDropOn(null);
                  }}
                  title={t("Drag to reorder")}
                  className="relative shrink-0 cursor-grab active:cursor-grabbing"
                >
                  {item.previewUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- local object URL or draft media preview
                    <img src={item.previewUrl} alt="" draggable={false} className="size-12 rounded-md object-cover" />
                  ) : (
                    <span className="flex size-12 items-center justify-center rounded-md bg-info-light text-info">
                      <Icon name="image" size={20} />
                    </span>
                  )}
                  <span className="absolute -start-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full bg-primary text-[11px] font-semibold tabular-nums text-inverse ring-2 ring-card">
                    <span aria-hidden="true">{place}</span>
                    <span className="sr-only">{t("Photo {place} of {total}", { place, total: images })}</span>
                  </span>
                </span>
              ) : item.previewUrl && item.purpose === "post_video" ? (
                <video src={item.previewUrl} muted playsInline preload="metadata" aria-hidden="true" className="h-12 w-20 shrink-0 rounded-md bg-ink object-cover" />
              ) : item.previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- local object URL or draft media preview
                <img src={item.previewUrl} alt="" className={cn("shrink-0 rounded-md object-cover", cover ? "h-16 w-28" : "size-12")} />
              ) : item.purpose === "post_video" ? (
                <span className="flex h-12 w-20 shrink-0 items-center justify-center rounded-md bg-warning-light text-warning">
                  <Icon name="video" size={20} />
                </span>
              ) : item.purpose === "post_image" ? (
                <span className="flex size-12 shrink-0 items-center justify-center rounded-md bg-info-light text-info">
                  <Icon name="image" size={20} />
                </span>
              ) : (
                <span className="flex size-12 shrink-0 items-center justify-center rounded-md bg-error-light text-[11px] font-bold text-error">PDF</span>
              )}
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="truncate text-sm font-medium text-ink">{item.name}</span>
                <span className={cn("text-xs", item.status === "rejected" ? "text-error" : item.status === "ready" ? "text-success" : "text-secondary")}>
                  {item.size > 0 && `${formatBytes(item.size)} · `}
                  {statusText(t, item)}
                </span>
                {(item.status === "uploading" || item.status === "scanning") && (
                  <span
                    className="h-1 w-full overflow-hidden rounded bg-muted"
                    role="progressbar"
                    aria-label={t("Uploading {name}", { name: item.name })}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(item.progress * 100)}
                  >
                    <span
                      className={cn("block h-full rounded bg-primary-light transition-[width]", item.status === "scanning" && "animate-pulse")}
                      style={{ width: `${Math.round(item.progress * 100)}%` }}
                    />
                  </span>
                )}
                {item.purpose === "post_image" && item.status !== "rejected" && <AltTextField item={item} onChange={(alt) => setAlt(item.key, alt)} />}
              </span>
              {ordered && (
                <span className="flex shrink-0 flex-col">
                  <button
                    ref={(node) => {
                      arrows.current.set(`${item.key}:earlier`, node);
                    }}
                    type="button"
                    onClick={() => shift(item.key, -1)}
                    disabled={index === 0}
                    className="rounded-md p-1 text-secondary hover:bg-muted hover:text-ink disabled:pointer-events-none disabled:opacity-30"
                    aria-label={t("Move {name} earlier", { name: item.name })}
                  >
                    <Icon name="chevron-down" size={16} className="rotate-180" />
                  </button>
                  <button
                    ref={(node) => {
                      arrows.current.set(`${item.key}:later`, node);
                    }}
                    type="button"
                    onClick={() => shift(item.key, 1)}
                    disabled={index === items.length - 1}
                    className="rounded-md p-1 text-secondary hover:bg-muted hover:text-ink disabled:pointer-events-none disabled:opacity-30"
                    aria-label={t("Move {name} later", { name: item.name })}
                  >
                    <Icon name="chevron-down" size={16} />
                  </button>
                </span>
              )}
              <button
                type="button"
                onClick={() => remove(item.key)}
                className="shrink-0 rounded-md p-1.5 text-secondary hover:bg-muted hover:text-error"
                aria-label={t("Remove {name}", { name: item.name })}
              >
                <Icon name="x" size={16} />
              </button>
            </li>
            );
          })}
        </ul>
      )}
      {ordered && layout && onLayoutChange && (
        <>
          <MediaLayoutPicker id={`${id}-layout`} value={layout} onChange={onLayoutChange} />
          <MediaLayoutPreview images={previewImages} layout={layout} />
        </>
      )}
    </div>
  );
}
