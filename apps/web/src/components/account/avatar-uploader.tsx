"use client";

import { useId, useRef, useState } from "react";
import { UPLOAD_LIMITS, type OwnProfile } from "@chartermission/contracts";
import { Avatar, Button, cn, type AvatarTone } from "@chartermission/ui";
import { api, isApiError } from "@/lib/api/client";
import { uploadFile } from "@/lib/upload";
import { ResendVerification } from "@/components/auth/resend-verification";

type Status =
  | { kind: "idle" }
  | { kind: "uploading"; progress: number }
  | { kind: "processing" }
  | { kind: "done"; text: string }
  | { kind: "error"; text: string; unverified?: boolean };

/**
 * Avatar picker (CM-PRF-07): uploads through lib/upload, then PATCH /me/profile { avatarFileId }.
 * JPEG, PNG or WebP up to 5 MB; the server re-encodes and strips metadata.
 */
export function AvatarUploader({
  name,
  tone,
  avatarUrl,
  onChange,
  size = 96,
}: {
  name: string;
  tone: AvatarTone;
  avatarUrl: string | null;
  onChange?: (avatarUrl: string | null) => void;
  size?: 56 | 96;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState(avatarUrl);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const busy = status.kind === "uploading" || status.kind === "processing";

  async function handleFile(file: File) {
    setStatus({ kind: "uploading", progress: 0 });
    try {
      const view = await uploadFile(file, "avatar", (fraction) =>
        setStatus(fraction >= 1 ? { kind: "processing" } : { kind: "uploading", progress: fraction }),
      );
      const profile = await api<OwnProfile>("/me/profile", { method: "PATCH", body: { avatarFileId: view.id } });
      setUrl(profile.avatarUrl);
      onChange?.(profile.avatarUrl);
      setStatus({ kind: "done", text: "Your photo has been updated." });
    } catch (error) {
      if (isApiError(error, "EMAIL_NOT_VERIFIED")) {
        setStatus({ kind: "error", text: "Verify your email to upload a photo.", unverified: true });
      } else {
        setStatus({ kind: "error", text: isApiError(error) ? error.message : "The upload failed. Please try again." });
      }
    } finally {
      if (input.current) input.current.value = "";
    }
  }

  async function remove() {
    setStatus({ kind: "processing" });
    try {
      await api<OwnProfile>("/me/profile", { method: "PATCH", body: { avatarFileId: null } });
      setUrl(null);
      onChange?.(null);
      setStatus({ kind: "done", text: "Your photo has been removed." });
    } catch (error) {
      setStatus({ kind: "error", text: isApiError(error) ? error.message : "Something went wrong. Please try again." });
    }
  }

  return (
    <div className="flex items-center gap-4">
      <span className="relative">
        <Avatar name={name} tone={tone} src={url ?? undefined} size={size} />
        {busy && <span aria-hidden="true" className="absolute inset-0 animate-pulse rounded-full bg-card/60" />}
      </span>
      <div className="flex min-w-0 flex-1 flex-col items-start gap-2">
        <div className="flex flex-wrap gap-2">
          <input
            ref={input}
            id={`${id}-file`}
            type="file"
            accept={UPLOAD_LIMITS.avatar.mimes.join(",")}
            className="sr-only"
            tabIndex={-1}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
            }}
          />
          <Button
            variant="secondary"
            size="small"
            disabled={busy}
            onClick={() => input.current?.click()}
            aria-describedby={`${id}-hint`}
          >
            {url ? "Change photo" : "Upload photo"}
          </Button>
          {url && (
            <Button variant="ghost" size="small" disabled={busy} onClick={() => void remove()}>
              Remove
            </Button>
          )}
        </div>
        <p id={`${id}-hint`} className="text-xs text-secondary">
          JPEG, PNG or WebP, up to 5 MB.
        </p>
        <div aria-live="polite" className="w-full empty:hidden">
          {status.kind === "uploading" && (
            <div className="flex w-full max-w-[240px] flex-col gap-1">
              <span className="text-xs text-secondary">Uploading… {Math.round(status.progress * 100)}%</span>
              <span className="h-1 w-full overflow-hidden rounded-full bg-muted">
                <span className="block h-full bg-primary transition-[width]" style={{ width: `${status.progress * 100}%` }} />
              </span>
            </div>
          )}
          {status.kind === "processing" && <span className="text-xs text-secondary">Checking your photo…</span>}
          {status.kind === "done" && <span className="text-xs text-success">{status.text}</span>}
          {status.kind === "error" && (
            <div className={cn("flex flex-col items-start gap-1.5")}>
              <span className="text-xs text-error">{status.text}</span>
              {status.unverified && <ResendVerification size="small" variant="ghost" label="Resend verification email" />}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
