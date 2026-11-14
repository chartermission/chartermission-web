"use client";

import { useId, useRef, useState } from "react";
import { UPLOAD_LIMITS, type UploadPurpose } from "@chartermission/contracts";
import { Button, cn } from "@chartermission/ui";
import { ImageCropDialog, assertCroppable } from "@/components/account/image-crop-dialog";
import { isApiError } from "@/lib/api/client";
import { uploadFile } from "@/lib/upload";
import { PageLogo } from "./page-logo";
import { T, useT } from "@/i18n/client";

type Status = { kind: "idle" } | { kind: "uploading"; progress: number } | { kind: "processing" } | { kind: "error"; text: string };

/**
 * Logo or cover picker for a page: choose → crop (square logo, 4:1 cover) → upload. The parent
 * gets the uploaded file id and keeps it until the form is saved; null removes the picture.
 */
export function PagePictureField({
  kind,
  name,
  url,
  onChange,
  purpose: purposeOverride,
}: {
  kind: "logo" | "cover";
  /** Upload purpose; defaults to page_logo / page_cover (initiatives use initiative_cover). */
  purpose?: UploadPurpose;
  /** The page name, for the logo placeholder. */
  name: string;
  url: string | null;
  onChange: (picture: { fileId: string | null; url: string | null }) => void;
}) {
  const t = useT();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [picked, setPicked] = useState<File | null>(null);
  const purpose: UploadPurpose = purposeOverride ?? (kind === "logo" ? "page_logo" : "page_cover");
  const busy = status.kind === "uploading" || status.kind === "processing";

  function pick(file: File) {
    if (input.current) input.current.value = "";
    try {
      assertCroppable(file, purpose);
      setStatus({ kind: "idle" });
      setPicked(file);
    } catch (error) {
      setStatus({ kind: "error", text: isApiError(error) ? error.message : "Choose a JPEG, PNG or WebP image." });
    }
  }

  async function upload(file: File) {
    setStatus({ kind: "uploading", progress: 0 });
    try {
      const view = await uploadFile(file, purpose, (fraction) => setStatus(fraction >= 1 ? { kind: "processing" } : { kind: "uploading", progress: fraction }));
      onChange({ fileId: view.id, url: view.url });
      setStatus({ kind: "idle" });
    } catch (error) {
      setStatus({ kind: "error", text: isApiError(error) ? error.message : "The upload failed. Please try again." });
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium text-ink">{kind === "logo" ? "Logo" : "Cover"}</span>
      <div className={cn("flex gap-3", kind === "logo" ? "items-center" : "flex-col")}>
        {kind === "logo" ? (
          <PageLogo name={name || "Page"} src={url} size={72} className={busy ? "animate-pulse" : undefined} />
        ) : (
          <div className={cn("h-[96px] w-full overflow-hidden rounded-card border border-line", busy && "animate-pulse")}>
            {url ? (
              // eslint-disable-next-line @next/next/no-img-element -- permission-checked API media
              <img src={url} alt="" className="h-full w-full object-cover" />
            ) : (
              <div aria-hidden="true" className="h-full w-full bg-gradient-to-r from-primary-dark via-primary-light via-65% to-accent opacity-60" />
            )}
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={input}
              id={`${id}-file`}
              type="file"
              accept={UPLOAD_LIMITS[purpose].mimes.join(",")}
              className="sr-only"
              tabIndex={-1}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) pick(file);
              }}
            />
            <Button variant="secondary" size="small" disabled={busy} onClick={() => input.current?.click()} aria-describedby={`${id}-hint`}>
              {kind === "logo" ? (url ? t("Change logo") : t("Upload logo")) : url ? t("Change cover") : t("Upload cover")}
            </Button>
            {url && (
              <Button variant="ghost" size="small" disabled={busy} onClick={() => onChange({ fileId: null, url: null })}>
                Remove
              </Button>
            )}
          </div>
          <p id={`${id}-hint`} className="text-xs text-secondary">
            {kind === "logo" ? "A square image, at least 300 × 300." : "A wide image works best."} JPEG, PNG or WebP. You can crop it before saving.
          </p>
          <div aria-live="polite" className="empty:hidden">
            {status.kind === "uploading" && <span className="text-xs text-secondary"><T vars={{ number: Math.round(status.progress * 100) }}>{"Uploading… {number}%"}</T></span>}
            {status.kind === "processing" && <span className="text-xs text-secondary">Checking the picture…</span>}
            {status.kind === "error" && <span className="text-xs text-error">{status.text}</span>}
          </div>
        </div>
      </div>
      <ImageCropDialog
        file={picked}
        title={kind === "logo" ? "Adjust the logo" : "Adjust the cover"}
        aspect={kind === "logo" ? 1 : 4}
        shape="rect"
        outputWidth={kind === "logo" ? 600 : 1600}
        onCancel={() => setPicked(null)}
        onConfirm={(cropped) => {
          setPicked(null);
          void upload(cropped);
        }}
      />
    </div>
  );
}
