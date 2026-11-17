"use client";

import { useRef, useState } from "react";
import { Button, Icon, cn } from "@chartermission/ui";
import { errorMessage } from "@/lib/api/client";
import { uploadFile } from "@/lib/upload";

/** A certificate signature: uploaded here (PNG, JPEG or WebP), sent to Charter Center as a public link. */
export function SignatureField({
  label = "Instructor’s signature",
  preview,
  error,
  onUploaded,
}: {
  label?: string;
  preview: string | null;
  error?: string;
  onUploaded: (fileId: string, url: string | null) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const shown = problem ?? error;

  async function pick(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setProblem(null);
    try {
      const view = await uploadFile(file, "certificate_signature");
      onUploaded(view.id, view.url);
    } catch (e) {
      setProblem(errorMessage(e));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-ink">{label}</span>
      <div className="flex flex-wrap items-center gap-4">
        <SignaturePreview url={preview} alt={label} invalid={!!shown} />
        <div className="flex flex-col items-start gap-1.5">
          <Button type="button" variant="secondary" size="small" disabled={busy} aria-busy={busy} onClick={() => input.current?.click()}>
            <Icon name="image" size={16} />
            {busy ? "Uploading…" : preview ? "Replace signature" : "Upload signature"}
          </Button>
          <span className="text-xs text-secondary">A PNG with a transparent background works best. Up to 2 MB.</span>
        </div>
        <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => void pick(e.target.files?.[0])} />
      </div>
      {shown && (
        <p role="alert" className="text-xs text-error">
          {shown}
        </p>
      )}
    </div>
  );
}

/** A signature image on white, as it is printed; "No signature yet" without one. */
export function SignaturePreview({ url, alt, invalid, small }: { url: string | null; alt: string; invalid?: boolean; small?: boolean }) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-white",
        small ? "h-[48px] w-[140px]" : "h-[84px] w-[240px]",
        invalid ? "border-error" : "border-line",
      )}
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- a stored upload, not a static asset
        <img src={url} alt={alt} className={cn("object-contain", small ? "max-h-[40px] max-w-[128px]" : "max-h-[72px] max-w-[220px]")} />
      ) : (
        <span className="text-xs text-secondary">No signature yet</span>
      )}
    </div>
  );
}
