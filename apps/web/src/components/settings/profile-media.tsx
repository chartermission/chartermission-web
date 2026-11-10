"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { UPLOAD_LIMITS, formatDuration, type OwnProfile } from "@chartermission/contracts";
import { Button, Icon } from "@chartermission/ui";
import { ErrorNotice } from "@/components/social/errors";
import { toast } from "@/components/social/toast";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api/client";
import { getMediaLimits } from "@/lib/media-limits";
import { UploadCancelled, chooseVideoPart, uploadFile } from "@/lib/upload";
import { SettingsCard } from "./settings-card";

const megabytes = (bytes: number) => Math.round(bytes / 1024 / 1024);
const fileSize = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

type Busy = { what: "video" | "resume"; step: "uploading" | "processing" | "saving"; progress: number } | null;

/**
 * Intro video and résumé (PATCH /me/profile with introVideoFileId / resumeFileId). Each saves as
 * soon as its upload has been checked, separately from the rest of the profile form. The video
 * goes through the same trim window as post videos, so a longer recording can be cut to fit.
 */
export function ProfileMedia({ profile }: { profile: Pick<OwnProfile, "introVideo" | "resume"> }) {
  const t = useT();
  const router = useRouter();
  const [video, setVideo] = useState(profile.introVideo);
  const [resume, setResume] = useState(profile.resume);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<{ what: "video" | "resume"; error: unknown } | null>(null);
  const [maxSeconds, setMaxSeconds] = useState(300);
  const videoInput = useRef<HTMLInputElement>(null);
  const resumeInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void getMediaLimits().then((limits) => setMaxSeconds(limits.introVideoMaxSeconds));
  }, []);

  async function save(body: { introVideoFileId?: string | null; resumeFileId?: string | null }) {
    const next = await api<OwnProfile>("/me/profile", { method: "PATCH", body });
    setVideo(next.introVideo);
    setResume(next.resume);
    router.refresh();
  }

  async function addVideo(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      const limits = await getMediaLimits();
      const trim = await chooseVideoPart(file, limits.introVideoMaxSeconds);
      setBusy({ what: "video", step: "uploading", progress: 0 });
      const uploaded = await uploadFile(
        file,
        "profile_video",
        (fraction) => setBusy({ what: "video", step: fraction >= 1 ? "processing" : "uploading", progress: fraction }),
        trim,
      );
      setBusy({ what: "video", step: "saving", progress: 1 });
      await save({ introVideoFileId: uploaded.id });
      toast.success(t("Your intro video is on your profile"));
    } catch (e) {
      if (!(e instanceof UploadCancelled)) setError({ what: "video", error: e });
    } finally {
      setBusy(null);
      if (videoInput.current) videoInput.current.value = "";
    }
  }

  async function addResume(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      setBusy({ what: "resume", step: "uploading", progress: 0 });
      const uploaded = await uploadFile(file, "profile_resume", (fraction) => setBusy({ what: "resume", step: fraction >= 1 ? "processing" : "uploading", progress: fraction }));
      setBusy({ what: "resume", step: "saving", progress: 1 });
      await save({ resumeFileId: uploaded.id });
      toast.success(t("Your résumé is on your profile"));
    } catch (e) {
      setError({ what: "resume", error: e });
    } finally {
      setBusy(null);
      if (resumeInput.current) resumeInput.current.value = "";
    }
  }

  async function remove(what: "video" | "resume") {
    setError(null);
    setBusy({ what, step: "saving", progress: 1 });
    try {
      await save(what === "video" ? { introVideoFileId: null } : { resumeFileId: null });
      toast.success(what === "video" ? t("Intro video removed") : t("Résumé removed"));
    } catch (e) {
      setError({ what, error: e });
    } finally {
      setBusy(null);
    }
  }

  const status = (what: "video" | "resume") =>
    busy?.what !== what
      ? null
      : busy.step === "uploading"
        ? t("Uploading… {percent}%", { percent: Math.round(busy.progress * 100) })
        : busy.step === "processing"
          ? what === "video"
            ? t("Converting your video. This can take a minute or two; keep this page open.")
            : t("Checking the file…")
          : t("Saving…");

  return (
    <SettingsCard
      id="intro"
      title={t("Intro video and résumé")}
      description={t("Introduce yourself in your own words, and attach your résumé for people who want the detail. You choose who sees each in Privacy & visibility.")}
      list={false}
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            <h3 className="text-md font-medium text-ink">{t("Intro video")}</h3>
            <p className="text-sm text-secondary">{t("Up to {length} minutes. MP4, MOV or WebM. A longer recording can be trimmed before it uploads.", { length: Math.round(maxSeconds / 60) })}</p>
          </div>
          <div className="flex items-center gap-2">
            <input ref={videoInput} type="file" accept="video/mp4,video/quicktime,video/webm" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => void addVideo(e.target.files?.[0])} />
            <Button variant="secondary" size="small" disabled={!!busy} onClick={() => videoInput.current?.click()}>
              <Icon name="video" size={16} />
              {video ? t("Replace video") : t("Add a video")}
            </Button>
            {video && (
              <Button variant="ghost" size="small" disabled={!!busy} onClick={() => void remove("video")}>
                {t("Remove")}
              </Button>
            )}
          </div>
        </div>
        {status("video") && (
          <p role="status" className="flex items-center gap-2 text-sm text-body">
            <span className="block size-4 animate-spin rounded-full border-2 border-line border-t-primary" aria-hidden="true" />
            {status("video")}
          </p>
        )}
        {error?.what === "video" ? <ErrorNotice error={error.error} /> : null}
        {video && (
          <div dir="ltr" className="overflow-hidden rounded-[10px] bg-ink">
            <video src={video.url} poster={video.posterUrl ?? undefined} controls playsInline preload="metadata" aria-label={t("Your intro video")} className="block max-h-[360px] w-full bg-ink object-contain" />
          </div>
        )}
        {video?.durationSeconds ? <p className="text-xs text-secondary">{t("Length {duration}", { duration: formatDuration(video.durationSeconds) })}</p> : null}
      </div>

      <div className="flex flex-col gap-3 border-t border-line pt-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            <h3 className="text-md font-medium text-ink">{t("Résumé")}</h3>
            <p className="text-sm text-secondary">{t("A PDF up to {size} MB. Shown to your connections unless you choose otherwise.", { size: megabytes(UPLOAD_LIMITS.profile_resume.maxBytes) })}</p>
          </div>
          <div className="flex items-center gap-2">
            <input ref={resumeInput} type="file" accept="application/pdf" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => void addResume(e.target.files?.[0])} />
            <Button variant="secondary" size="small" disabled={!!busy} onClick={() => resumeInput.current?.click()}>
              <Icon name="link" size={16} />
              {resume ? t("Replace résumé") : t("Attach a résumé")}
            </Button>
            {resume && (
              <Button variant="ghost" size="small" disabled={!!busy} onClick={() => void remove("resume")}>
                {t("Remove")}
              </Button>
            )}
          </div>
        </div>
        {status("resume") && (
          <p role="status" className="flex items-center gap-2 text-sm text-body">
            <span className="block size-4 animate-spin rounded-full border-2 border-line border-t-primary" aria-hidden="true" />
            {status("resume")}
          </p>
        )}
        {error?.what === "resume" ? <ErrorNotice error={error.error} /> : null}
        {resume && (
          <a href={resume.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 self-start rounded-lg border border-line px-3.5 py-2.5 hover:bg-muted">
            <span className="flex size-9 items-center justify-center rounded-md bg-error-light text-xs font-semibold text-error">PDF</span>
            <span className="flex min-w-0 flex-col">
              <span dir="auto" className="truncate text-sm font-medium text-ink">
                {resume.name}
              </span>
              <span className="text-xs text-secondary">{fileSize(resume.sizeBytes)}</span>
            </span>
          </a>
        )}
      </div>
    </SettingsCard>
  );
}
