"use client";

import { useEffect, useRef, useState } from "react";
import type { UploadPurpose } from "@chartermission/contracts";
import { Icon, cn } from "@chartermission/ui";
import { uploadFile } from "@/lib/upload";
import { errorMessage } from "@/components/social/errors";
import { formatBytes } from "@/components/social/format";

export const MAX_IMAGES = 4;

export type Attachment = {
  key: string;
  name: string;
  size: number;
  purpose: Extract<UploadPurpose, "post_image" | "post_document">;
  previewUrl: string | null;
  progress: number;
  status: "uploading" | "scanning" | "ready" | "rejected";
  fileId: string | null;
  error: string | null;
};

let counter = 0;

/**
 * Up to 4 images or 1 PDF (CM-FED-01). Each file goes through lib/upload.ts:
 * signed upload with progress, then the server-side validation and malware scan.
 */
export function useAttachments() {
  const [items, setItems] = useState<Attachment[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const urls = useRef(new Set<string>());

  useEffect(() => {
    const created = urls.current;
    return () => created.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  const patch = (key: string, change: Partial<Attachment>) =>
    setItems((current) => current.map((item) => (item.key === key ? { ...item, ...change } : item)));

  function add(files: File[], kind: "image" | "document") {
    setNotice(null);
    const live = items.filter((item) => item.status !== "rejected");
    const hasDoc = live.some((item) => item.purpose === "post_document");
    const imageCount = live.filter((item) => item.purpose === "post_image").length;
    let accepted: File[];
    if (kind === "document") {
      if (imageCount > 0 || hasDoc) {
        setNotice("A post can have up to 4 images or 1 PDF, not both. Remove the current files first.");
        return;
      }
      accepted = files.slice(0, 1);
    } else {
      if (hasDoc) {
        setNotice("A post can have up to 4 images or 1 PDF, not both. Remove the PDF first.");
        return;
      }
      accepted = files.slice(0, Math.max(0, MAX_IMAGES - imageCount));
      if (accepted.length < files.length) setNotice(`You can add up to ${MAX_IMAGES} images.`);
    }

    const next: Attachment[] = accepted.map((file) => {
      const previewUrl = kind === "image" && file.type.startsWith("image/") ? URL.createObjectURL(file) : null;
      if (previewUrl) urls.current.add(previewUrl);
      return {
        key: `att-${++counter}`,
        name: file.name,
        size: file.size,
        purpose: kind === "image" ? "post_image" : "post_document",
        previewUrl,
        progress: 0,
        status: "uploading",
        fileId: null,
        error: null,
      };
    });
    setItems((current) => [...current, ...next]);

    next.forEach((item, index) => {
      const file = accepted[index]!;
      uploadFile(file, item.purpose, (fraction) => patch(item.key, fraction >= 1 ? { progress: 1, status: "scanning" } : { progress: fraction }))
        .then((view) => patch(item.key, { status: "ready", fileId: view.id, progress: 1 }))
        .catch((e: unknown) => patch(item.key, { status: "rejected", error: errorMessage(e) }));
    });
  }

  function remove(key: string) {
    setItems((current) => {
      const item = current.find((i) => i.key === key);
      if (item?.previewUrl) {
        URL.revokeObjectURL(item.previewUrl);
        urls.current.delete(item.previewUrl);
      }
      return current.filter((i) => i.key !== key);
    });
    setNotice(null);
  }

  return {
    items,
    notice,
    add,
    remove,
    ids: items.filter((item) => item.status === "ready" && item.fileId).map((item) => item.fileId!),
    busy: items.some((item) => item.status === "uploading" || item.status === "scanning"),
    rejected: items.some((item) => item.status === "rejected"),
  };
}

export type AttachmentsState = ReturnType<typeof useAttachments>;

function statusText(item: Attachment) {
  switch (item.status) {
    case "uploading":
      return `Uploading ${Math.round(item.progress * 100)}%`;
    case "scanning":
      return "Checking file…";
    case "ready":
      return "Ready";
    case "rejected":
      return item.error ?? "This file couldn’t be accepted";
  }
}

/** File chooser and the list of uploads with progress, scan state and remove. */
export function AttachmentPicker({ state, id, mode }: { state: AttachmentsState; id: string; mode: "image" | "document" }) {
  const { items, notice, add, remove } = state;
  const images = items.filter((i) => i.purpose === "post_image" && i.status !== "rejected").length;
  const full = mode === "image" ? images >= MAX_IMAGES : items.some((i) => i.purpose === "post_document" && i.status !== "rejected");

  return (
    <div className="flex flex-col gap-3 rounded-card border border-dashed border-line-strong bg-surface p-4">
      {!full && (
        <label className="flex w-fit cursor-pointer items-center gap-2 rounded-md text-sm font-medium text-primary focus-within:ring-2 focus-within:ring-primary-light">
          <Icon name={mode === "image" ? "image" : "book"} size={18} className={mode === "image" ? "text-info" : "text-error"} />
          {mode === "image" ? (images ? "Add more images" : "Choose images to upload") : "Choose a PDF to upload"}
          <input
            id={id}
            type="file"
            accept={mode === "image" ? "image/jpeg,image/png,image/webp" : "application/pdf"}
            multiple={mode === "image"}
            className="sr-only"
            onChange={(event) => {
              add(Array.from(event.target.files ?? []), mode);
              event.target.value = "";
            }}
          />
        </label>
      )}
      <p className="text-xs text-secondary">
        {mode === "image" ? "Up to 4 images. JPEG, PNG or WebP, 5 MB each." : "One PDF, up to 10 MB."} Files are checked for safety before anyone else
        sees them.
      </p>
      {notice && (
        <p role="alert" className="text-xs text-warning">
          {notice}
        </p>
      )}
      {items.length > 0 && (
        <ul className="flex flex-col gap-2" aria-live="polite">
          {items.map((item) => (
            <li key={item.key} className="flex items-center gap-3 rounded-lg border border-line bg-card p-2">
              {item.previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- local object URL preview
                <img src={item.previewUrl} alt="" className="size-12 shrink-0 rounded-md object-cover" />
              ) : (
                <span className="flex size-12 shrink-0 items-center justify-center rounded-md bg-error-light text-[11px] font-bold text-error">PDF</span>
              )}
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="truncate text-sm font-medium text-ink">{item.name}</span>
                <span className={cn("text-xs", item.status === "rejected" ? "text-error" : item.status === "ready" ? "text-success" : "text-secondary")}>
                  {formatBytes(item.size)} · {statusText(item)}
                </span>
                {(item.status === "uploading" || item.status === "scanning") && (
                  <span
                    className="h-1 w-full overflow-hidden rounded bg-muted"
                    role="progressbar"
                    aria-label={`Uploading ${item.name}`}
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
              </span>
              <button
                type="button"
                onClick={() => remove(item.key)}
                className="shrink-0 rounded-md p-1.5 text-secondary hover:bg-muted hover:text-error"
                aria-label={`Remove ${item.name}`}
              >
                <Icon name="x" size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
