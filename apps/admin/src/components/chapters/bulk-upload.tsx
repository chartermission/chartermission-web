"use client";

import { useEffect, useId, useMemo, useRef, useState, type DragEvent } from "react";
import type { AdminChapterRow } from "@chartermission/contracts";
import { Button, Icon, buttonClasses, chapterLabel, cn } from "@chartermission/ui";
import { selectClasses } from "@/components/ambassadors/modal";
import { api, errorMessage } from "@/lib/api/client";
import { uploadFile } from "@/lib/upload";

type Kind = "picture" | "cover";
type Item = {
  key: string;
  file: File;
  preview: string;
  chapterId: string;
  kind: Kind;
  state: { kind: "ready" } | { kind: "uploading"; progress: number } | { kind: "done" } | { kind: "error"; text: string };
};

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const CONCURRENCY = 3;

const norm = (v: string) =>
  v
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/**
 * Reads a file name as "<chapter>[-cover]". <chapter> may be the chapter's link name (nigeria,
 * united-kingdom), its name ("Nigeria Chapter", "UK Diaspora"), its country ("Nigeria") or the ISO
 * code (NG). "-cover", "_banner" or " header" marks a cover; anything else (or "-picture",
 * "-avatar", "-logo") is the display picture.
 */
export function matchFile(fileName: string, chapters: AdminChapterRow[]): { chapterId: string; kind: Kind } {
  let base = norm(fileName.replace(/\.[a-z0-9]+$/i, ""));
  let kind: Kind = "picture";
  const suffix = /-(cover|banner|header)$/;
  if (suffix.test(base)) {
    kind = "cover";
    base = base.replace(suffix, "");
  }
  base = base.replace(/-(picture|avatar|logo|image|photo|display|profile|dp)$/, "").replace(/-chapter$/, "");
  const keys = (c: AdminChapterRow) => [
    c.slug,
    norm(chapterLabel(c.name)),
    norm(c.name),
    norm(c.countryName),
    c.countryCode.toLowerCase(),
    `${c.countryCode.toLowerCase()}-diaspora`,
  ];
  // Prefer an exact link-name match, then any key; African chapters win over diaspora on a bare country name.
  const exact = chapters.find((c) => c.slug === base);
  const hit = exact ?? chapters.find((c) => keys(c).includes(base));
  return { chapterId: hit?.id ?? "", kind };
}

/** Bulk upload of chapter pictures and covers: pick or drop many images, check the matches, upload. */
export function BulkPictureUpload({
  chapters,
  onUpdated,
  onClose,
}: {
  chapters: AdminChapterRow[];
  onUpdated: (row: AdminChapterRow) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const [items, setItems] = useState<Item[]>([]);
  const [running, setRunning] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [rejected, setRejected] = useState<string[]>([]);
  const sorted = useMemo(() => [...chapters].sort((a, b) => a.name.localeCompare(b.name)), [chapters]);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);
  // Object URLs for the previews are released when the dialog closes.
  const previews = useRef<string[]>([]);
  useEffect(() => () => previews.current.forEach((url) => URL.revokeObjectURL(url)), []);

  function track(url: string) {
    previews.current.push(url);
    return url;
  }

  function add(files: FileList | File[]) {
    const list = [...files];
    setRejected(list.filter((f) => !IMAGE_TYPES.includes(f.type)).map((f) => f.name));
    const next = list
      .filter((f) => IMAGE_TYPES.includes(f.type))
      .map((file) => ({
        key: `${file.name}-${file.size}-${file.lastModified}`,
        file,
        preview: track(URL.createObjectURL(file)),
        ...matchFile(file.name, chapters),
        state: { kind: "ready" as const },
      }));
    setItems((current) => [...current, ...next.filter((n) => !current.some((c) => c.key === n.key))]);
  }

  const update = (key: string, patch: Partial<Item>) => setItems((list) => list.map((i) => (i.key === key ? { ...i, ...patch } : i)));

  const ready = items.filter((i) => i.chapterId && i.state.kind !== "done");
  const unmatched = items.filter((i) => !i.chapterId).length;
  const duplicates = useMemo(() => {
    const seen = new Map<string, number>();
    for (const i of items) if (i.chapterId) seen.set(`${i.chapterId}:${i.kind}`, (seen.get(`${i.chapterId}:${i.kind}`) ?? 0) + 1);
    return new Set([...seen].filter(([, n]) => n > 1).map(([k]) => k));
  }, [items]);

  async function run() {
    setRunning(true);
    const queue = [...ready];
    const worker = async () => {
      for (let item = queue.shift(); item; item = queue.shift()) {
        const current = item;
        update(current.key, { state: { kind: "uploading", progress: 0 } });
        try {
          const view = await uploadFile(current.file, current.kind === "cover" ? "chapter_cover" : "chapter_image", (progress) =>
            update(current.key, { state: { kind: "uploading", progress } }),
          );
          const row = await api<AdminChapterRow>(`/admin/chapters/${current.chapterId}`, {
            method: "PATCH",
            body: current.kind === "cover" ? { coverFileId: view.id } : { imageFileId: view.id },
          });
          onUpdated(row);
          update(current.key, { state: { kind: "done" } });
        } catch (e) {
          update(current.key, { state: { kind: "error", text: errorMessage(e) } });
        }
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    setRunning(false);
  }

  const done = items.filter((i) => i.state.kind === "done").length;

  return (
    <dialog
      ref={ref}
      aria-labelledby={`${id}-title`}
      onClose={onClose}
      onCancel={(event) => {
        if (running) event.preventDefault();
      }}
      className="m-auto max-h-[calc(100dvh-32px)] w-[860px] max-w-[calc(100vw-32px)] rounded-card border border-line bg-card p-0 text-ink shadow-[0_12px_40px_rgba(25,37,80,0.18)] backdrop:bg-primary-dark/40"
    >
      <div className="flex flex-col gap-4 p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h2 id={`${id}-title`} className="text-h3 text-ink">
              Bulk upload chapter pictures
            </h2>
            <p className="text-sm text-body">
              Name each file after its chapter: the link name, the country or the country code, e.g. <code>nigeria.png</code>,{" "}
              <code>uk-diaspora.jpg</code>, <code>KE.webp</code>. Add <code>-cover</code> for a cover, e.g. <code>nigeria-cover.jpg</code>.
              Check the matches below before uploading.
            </p>
          </div>
          <button type="button" disabled={running} onClick={() => ref.current?.close()} className="-m-1 rounded-md p-1 text-secondary hover:bg-muted hover:text-ink">
            <Icon name="x" size={18} label="Close" />
          </button>
        </div>

        <div
          onDragOver={(e: DragEvent) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e: DragEvent) => {
            e.preventDefault();
            setDragging(false);
            add(e.dataTransfer.files);
          }}
          className={cn(
            "flex flex-col items-center gap-2 rounded-lg border-2 border-dashed px-4 py-6 text-center",
            dragging ? "border-primary-light bg-primary-tint-2" : "border-line-strong",
          )}
        >
          <Icon name="image" size={24} className="text-secondary" />
          <p className="text-sm text-body">Drop images here, or</p>
          <input
            ref={input}
            type="file"
            multiple
            accept={IMAGE_TYPES.join(",")}
            className="sr-only"
            tabIndex={-1}
            aria-label="Choose images"
            onChange={(e) => {
              if (e.target.files) add(e.target.files);
              e.target.value = "";
            }}
          />
          <Button variant="secondary" size="small" disabled={running} onClick={() => input.current?.click()}>
            Choose images
          </Button>
          <p className="text-xs text-secondary">JPEG, PNG or WebP. Pictures up to 8 MB, covers up to 10 MB.</p>
        </div>
        {rejected.length > 0 && <p className="text-xs text-error">Skipped (not JPEG, PNG or WebP): {rejected.join(", ")}</p>}

        {items.length > 0 && (
          <div className="max-h-[46dvh] overflow-y-auto rounded-lg border border-line">
            <table className="w-full border-collapse text-left text-sm">
              <caption className="sr-only">Files to upload</caption>
              <thead className="sticky top-0 border-b border-line bg-muted text-label text-secondary uppercase">
                <tr>
                  <th scope="col" className="py-2 pr-2 pl-3 font-semibold">File</th>
                  <th scope="col" className="py-2 pr-2 font-semibold">Chapter</th>
                  <th scope="col" className="py-2 pr-2 font-semibold">Use as</th>
                  <th scope="col" className="py-2 pr-3 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const locked = running || item.state.kind === "done" || item.state.kind === "uploading";
                  const dup = item.chapterId && duplicates.has(`${item.chapterId}:${item.kind}`);
                  return (
                    <tr key={item.key} className="border-t border-line first:border-t-0">
                      <td className="py-2 pr-2 pl-3">
                        <div className="flex items-center gap-2">
                          {/* eslint-disable-next-line @next/next/no-img-element -- local preview */}
                          <img src={item.preview} alt="" className={cn("shrink-0 object-cover", item.kind === "cover" ? "h-8 w-16 rounded" : "size-8 rounded-full")} />
                          <span className="max-w-[180px] truncate text-body" title={item.file.name}>
                            {item.file.name}
                          </span>
                        </div>
                      </td>
                      <td className="py-2 pr-2">
                        <span className="relative block">
                          <select
                            aria-label={`Chapter for ${item.file.name}`}
                            value={item.chapterId}
                            disabled={locked}
                            onChange={(e) => update(item.key, { chapterId: e.target.value })}
                            className={selectClasses(!item.chapterId)}
                          >
                            <option value="">No match: choose a chapter</option>
                            {sorted.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
                              </option>
                            ))}
                          </select>
                          <Icon name="chevron-down" size={14} className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-secondary" />
                        </span>
                        {dup && <span className="text-xs text-warning">Another file is set for this chapter; the last one uploaded wins.</span>}
                      </td>
                      <td className="py-2 pr-2">
                        <span className="relative block w-[130px]">
                          <select
                            aria-label={`Use ${item.file.name} as`}
                            value={item.kind}
                            disabled={locked}
                            onChange={(e) => update(item.key, { kind: e.target.value as Kind })}
                            className={selectClasses(false)}
                          >
                            <option value="picture">Picture</option>
                            <option value="cover">Cover</option>
                          </select>
                          <Icon name="chevron-down" size={14} className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-secondary" />
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-xs">
                        {item.state.kind === "ready" && (
                          <button
                            type="button"
                            disabled={running}
                            onClick={() => setItems((list) => list.filter((i) => i.key !== item.key))}
                            className="text-secondary underline hover:text-ink"
                          >
                            Remove
                          </button>
                        )}
                        {item.state.kind === "uploading" && <span className="text-secondary">Uploading… {Math.round(item.state.progress * 100)}%</span>}
                        {item.state.kind === "done" && (
                          <span className="flex items-center gap-1 text-primary-light">
                            <Icon name="check" size={14} />
                            Done
                          </span>
                        )}
                        {item.state.kind === "error" && (
                          <span role="alert" className="text-error">
                            {item.state.text}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <p className="text-sm text-secondary" aria-live="polite">
            {items.length === 0
              ? "No files yet."
              : `${items.length} ${items.length === 1 ? "file" : "files"} · ${done} uploaded${unmatched ? ` · ${unmatched} without a chapter (skipped)` : ""}`}
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" size="small" disabled={running} onClick={() => ref.current?.close()}>
              {done ? "Close" : "Cancel"}
            </Button>
            <button
              type="button"
              disabled={running || ready.length === 0}
              onClick={() => void run()}
              className={buttonClasses({ variant: "primary", size: "small" })}
            >
              {running ? "Uploading…" : `Upload ${ready.length || ""}`.trim()}
            </button>
          </div>
        </div>
      </div>
    </dialog>
  );
}
