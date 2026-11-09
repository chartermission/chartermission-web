"use client";

import { useEffect, useId, useRef, useState } from "react";
import { STORY_CAPTION_MAX_CHARS, formatDuration, type StoryView } from "@chartermission/contracts";
import { Button, Icon, cn } from "@chartermission/ui";
import { api } from "@/lib/api/client";
import { assertVideoLength, uploadFile } from "@/lib/upload";
import { getMediaLimits, readVideoDuration } from "@/lib/media-limits";
import { Dialog } from "@/components/social/dialog";
import { errorMessage } from "@/components/social/error-message";
import { inputClasses } from "@/components/auth/fields";

type Status = "idle" | "uploading" | "processing" | "ready" | "error";

/** "Add to your story": one photo or short video, an optional caption, shared for 24 hours. */
export function StoryComposer({ onClose, onPosted }: { onClose: () => void; onPosted: (story: StoryView) => void }) {
  const id = useId();
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [progress, setProgress] = useState(0);
  const [fileId, setFileId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const [posting, setPosting] = useState(false);
  const [maxSeconds, setMaxSeconds] = useState<number | null>(null);
  const attempt = useRef(0);
  const isVideo = !!file?.type.startsWith("video/");

  useEffect(() => {
    void getMediaLimits().then((l) => setMaxSeconds(l.storyVideoMaxSeconds));
  }, []);
  useEffect(() => () => void (previewUrl && URL.revokeObjectURL(previewUrl)), [previewUrl]);

  async function choose(next: File) {
    const run = ++attempt.current;
    setFile(next);
    setPreviewUrl(URL.createObjectURL(next));
    setFileId(null);
    setError(null);
    setProgress(0);
    setStatus("uploading");
    const video = next.type.startsWith("video/");
    try {
      if (video) {
        const [seconds, limits] = await Promise.all([readVideoDuration(next), getMediaLimits()]);
        assertVideoLength(seconds, limits.storyVideoMaxSeconds);
      }
      const view = await uploadFile(next, video ? "story_video" : "story_image", (fraction) => {
        if (run !== attempt.current) return;
        if (fraction >= 1) setStatus("processing");
        else setProgress(fraction);
      });
      if (run !== attempt.current) return;
      setFileId(view.id);
      setStatus("ready");
    } catch (e) {
      if (run !== attempt.current) return;
      setError(errorMessage(e));
      setStatus("error");
    }
  }

  async function share(closeFrom: HTMLElement | null) {
    if (!fileId) return;
    setPosting(true);
    setError(null);
    try {
      const story = await api<StoryView>("/stories", { method: "POST", body: { fileId, caption: caption.trim() || undefined } });
      onPosted(story);
      closeFrom?.closest("dialog")?.close();
    } catch (e) {
      setError(errorMessage(e));
      setPosting(false);
    }
  }

  return (
    <Dialog
      title="Add to your story"
      description="A photo or short video your connections and followers can see for 24 hours."
      onClose={onClose}
      width={460}
      footer={
        <>
          <Button variant="secondary" onClick={(e) => e.currentTarget.closest("dialog")?.close()}>
            Cancel
          </Button>
          <Button disabled={status !== "ready" || posting} onClick={(e) => void share(e.currentTarget)}>
            {posting ? "Sharing…" : "Share to story"}
          </Button>
        </>
      }
    >
      {previewUrl ? (
        <div className="relative mx-auto aspect-[9/16] w-full max-w-[240px] overflow-hidden rounded-xl bg-ink">
          {isVideo ? (
            <video src={previewUrl} muted playsInline autoPlay loop className="size-full object-contain" aria-label="Preview of your video" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- local object URL
            <img src={previewUrl} alt="Preview of your photo" className="size-full object-contain" />
          )}
        </div>
      ) : null}
      <label
        className={cn(
          "flex cursor-pointer items-center justify-center gap-2 rounded-card border border-dashed border-line-strong bg-surface p-4 text-sm font-medium text-primary focus-within:ring-2 focus-within:ring-primary-light",
          previewUrl && "p-2.5",
        )}
      >
        <Icon name="image" size={18} className="text-info" />
        {previewUrl ? "Choose a different photo or video" : "Choose a photo or video"}
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm"
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void choose(f);
            e.target.value = "";
          }}
        />
      </label>
      <p className="-mt-2 text-xs text-secondary">
        Photos: JPEG, PNG or WebP up to 5 MB. Videos: MP4, MOV or WebM{maxSeconds ? `, up to ${formatDuration(maxSeconds)}` : ""}.
      </p>
      {status === "uploading" && (
        <div className="flex flex-col gap-1" aria-live="polite">
          <span className="text-xs text-secondary">Uploading {Math.round(progress * 100)}%</span>
          <span className="h-1 w-full overflow-hidden rounded bg-muted" role="progressbar" aria-label="Upload progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
            <span className="block h-full rounded bg-primary-light" style={{ width: `${Math.round(progress * 100)}%` }} />
          </span>
        </div>
      )}
      {status === "processing" && (
        <p className="text-xs text-secondary" aria-live="polite">
          {isVideo ? "Processing your video…" : "Checking your photo…"}
        </p>
      )}
      {status === "ready" && (
        <p className="flex items-center gap-1 text-xs text-success" aria-live="polite">
          <Icon name="check" size={14} />
          Ready to share
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-error">
          {error}
        </p>
      )}
      <label htmlFor={`${id}-caption`} className="flex flex-col gap-1.5 text-sm font-medium text-ink">
        Caption <span className="sr-only">(optional)</span>
        <input
          id={`${id}-caption`}
          value={caption}
          maxLength={STORY_CAPTION_MAX_CHARS}
          placeholder="Add a caption (optional)"
          onChange={(e) => setCaption(e.target.value)}
          className={inputClasses(false)}
        />
      </label>
    </Dialog>
  );
}
