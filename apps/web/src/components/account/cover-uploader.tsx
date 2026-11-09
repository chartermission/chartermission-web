"use client";

import { useId, useRef, useState } from "react";
import { UPLOAD_LIMITS, type OwnProfile } from "@chartermission/contracts";
import { Button } from "@chartermission/ui";
import { api, isApiError } from "@/lib/api/client";
import { uploadFile } from "@/lib/upload";

type Status =
  | { kind: "idle" }
  | { kind: "uploading"; progress: number }
  | { kind: "processing" }
  | { kind: "done"; text: string }
  | { kind: "error"; text: string };

/**
 * Cover photo picker: uploads a profile_cover image through lib/upload, then
 * PATCH /me/profile { coverFileId }. Shown as the wide banner at the top of the profile.
 */
export function CoverUploader({ coverUrl, onChange }: { coverUrl: string | null; onChange?: (coverUrl: string | null) => void }) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState(coverUrl);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const busy = status.kind === "uploading" || status.kind === "processing";
  const maxMb = Math.round(UPLOAD_LIMITS.profile_cover.maxBytes / 1024 / 1024);

  async function handleFile(file: File) {
    setStatus({ kind: "uploading", progress: 0 });
    try {
      const view = await uploadFile(file, "profile_cover", (fraction) =>
        setStatus(fraction >= 1 ? { kind: "processing" } : { kind: "uploading", progress: fraction }),
      );
      const profile = await api<OwnProfile>("/me/profile", { method: "PATCH", body: { coverFileId: view.id } });
      setUrl(profile.coverUrl);
      onChange?.(profile.coverUrl);
      setStatus({ kind: "done", text: "Your cover photo has been updated." });
    } catch (error) {
      setStatus({ kind: "error", text: isApiError(error) ? error.message : "The upload failed. Please try again." });
    } finally {
      if (input.current) input.current.value = "";
    }
  }

  async function remove() {
    setStatus({ kind: "processing" });
    try {
      await api<OwnProfile>("/me/profile", { method: "PATCH", body: { coverFileId: null } });
      setUrl(null);
      onChange?.(null);
      setStatus({ kind: "done", text: "Your cover photo has been removed." });
    } catch (error) {
      setStatus({ kind: "error", text: isApiError(error) ? error.message : "Something went wrong. Please try again." });
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <span className="text-sm font-medium text-ink">Cover photo</span>
      <div className="relative h-[96px] w-full overflow-hidden rounded-card border border-line">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element -- permission-checked API media
          <img src={url} alt="Your cover photo" className="h-full w-full object-cover" />
        ) : (
          <div
            aria-hidden="true"
            className="h-full w-full bg-gradient-to-r from-primary-dark via-primary-light via-65% to-accent opacity-60"
          />
        )}
        {busy && <span aria-hidden="true" className="absolute inset-0 animate-pulse bg-card/60" />}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={input}
          id={`${id}-file`}
          type="file"
          accept={UPLOAD_LIMITS.profile_cover.mimes.join(",")}
          className="sr-only"
          tabIndex={-1}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
          }}
        />
        <Button variant="secondary" size="small" disabled={busy} onClick={() => input.current?.click()} aria-describedby={`${id}-hint`}>
          {url ? "Change cover photo" : "Upload cover photo"}
        </Button>
        {url && (
          <Button variant="ghost" size="small" disabled={busy} onClick={() => void remove()}>
            Remove
          </Button>
        )}
      </div>
      <p id={`${id}-hint`} className="text-xs text-secondary">
        A wide image works best (about 1600 × 400). JPEG, PNG or WebP, up to {maxMb} MB.
      </p>
      <div aria-live="polite" className="empty:hidden">
        {status.kind === "uploading" && (
          <span className="text-xs text-secondary">Uploading… {Math.round(status.progress * 100)}%</span>
        )}
        {status.kind === "processing" && <span className="text-xs text-secondary">Checking your photo…</span>}
        {status.kind === "done" && <span className="text-xs text-success">{status.text}</span>}
        {status.kind === "error" && <span className="text-xs text-error">{status.text}</span>}
      </div>
    </div>
  );
}
