"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import { UPLOAD_LIMITS, type UploadPurpose } from "@chartermission/contracts";
import { Button, Icon } from "@chartermission/ui";
import { errorMessage } from "@/lib/api/client";
import { uploadFile } from "@/lib/upload";

/** Image picker for a chapter picture or cover: uploads right away, the parent saves the file id with the form. */
export function PictureField({
  label,
  hint,
  purpose,
  preview,
  custom,
  disabled,
  onUploaded,
  onReset,
}: {
  label: string;
  hint: string;
  purpose: UploadPurpose;
  preview: ReactNode;
  /** A custom image is set (offer "Use generated design"). */
  custom: boolean;
  disabled?: boolean;
  onUploaded: (fileId: string, url: string | null) => void;
  onReset: () => void;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<{ kind: "idle" } | { kind: "uploading"; progress: number } | { kind: "error"; text: string }>({ kind: "idle" });
  const uploading = state.kind === "uploading";

  async function onFile(file: File) {
    setState({ kind: "uploading", progress: 0 });
    try {
      const view = await uploadFile(file, purpose, (progress) => setState({ kind: "uploading", progress }));
      // Preview from the local file: the media URL needs the save to happen first.
      onUploaded(view.id, URL.createObjectURL(file));
      setState({ kind: "idle" });
    } catch (e) {
      setState({ kind: "error", text: errorMessage(e) });
    } finally {
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span id={`${id}-label`} className="text-label text-ink">
        {label}
      </span>
      <div className="flex flex-wrap items-center gap-4">
        {preview}
        <div className="flex flex-col items-start gap-1.5">
          <div className="flex flex-wrap gap-2">
            <input
              ref={input}
              type="file"
              accept={UPLOAD_LIMITS[purpose].mimes.join(",")}
              className="sr-only"
              tabIndex={-1}
              aria-labelledby={`${id}-label`}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void onFile(file);
              }}
            />
            <Button variant="secondary" size="small" disabled={disabled || uploading} onClick={() => input.current?.click()}>
              <Icon name="image" size={14} />
              {uploading ? `Uploading… ${Math.round(state.progress * 100)}%` : "Upload"}
            </Button>
            {custom && (
              <Button variant="ghost" size="small" disabled={disabled || uploading} onClick={onReset}>
                Use generated design
              </Button>
            )}
          </div>
          <p className="text-xs text-secondary">{hint}</p>
          {state.kind === "error" && (
            <p role="alert" className="flex items-center gap-1.5 text-xs text-error">
              <Icon name="alert" size={14} />
              {state.text}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
