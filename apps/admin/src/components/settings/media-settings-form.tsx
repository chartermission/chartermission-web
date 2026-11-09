"use client";

import { useState, type FormEvent } from "react";
import { formatDuration, type MediaSettings } from "@chartermission/contracts";
import { Button } from "@chartermission/ui";
import { FormNotice, TextField } from "@/components/form-field";
import { ApiError, api, errorMessage } from "@/lib/api/client";

type Field = { key: keyof MediaSettings; label: string; note: string; min: number; max: number };

const FIELDS: Field[] = [
  { key: "postVideoMaxSeconds", label: "Feed post videos", note: "Longest video a member can upload to a post.", min: 10, max: 3600 },
  { key: "storyVideoMaxSeconds", label: "Story videos", note: "Longest video in a story.", min: 5, max: 180 },
];

/**
 * Video length limits (PUT /admin/settings/media). Platform Admins only; audited. Applies to uploads
 * from now on: videos already processed keep their length. Links to YouTube and other platforms have no limit.
 */
export function MediaSettingsForm({ initial }: { initial: MediaSettings }) {
  const [values, setValues] = useState(initial);
  const [draft, setDraft] = useState<Record<keyof MediaSettings, string>>({
    postVideoMaxSeconds: String(initial.postVideoMaxSeconds),
    storyVideoMaxSeconds: String(initial.storyVideoMaxSeconds),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof MediaSettings, string>>>({});
  const [saved, setSaved] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = {} as MediaSettings;
    const errors: Partial<Record<keyof MediaSettings, string>> = {};
    for (const f of FIELDS) {
      const value = Number(draft[f.key]);
      if (!Number.isInteger(value) || value < f.min || value > f.max) errors[f.key] = `Enter whole seconds from ${f.min} to ${f.max}`;
      next[f.key] = value;
    }
    setFieldErrors(errors);
    setError(null);
    setSaved(false);
    if (Object.keys(errors).length) return;
    setBusy(true);
    try {
      const result = await api<MediaSettings>("/admin/settings/media", { method: "PUT", body: next });
      setValues(result);
      setSaved(true);
    } catch (e) {
      if (e instanceof ApiError && e.fields) setFieldErrors(e.fields as Partial<Record<keyof MediaSettings, string>>);
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="video-limits" className="flex flex-col gap-4 rounded-card border border-line bg-card px-5 py-4">
      <div className="flex flex-col gap-1">
        <h2 id="video-limits" className="text-h3 text-ink">
          Video length
        </h2>
        <p className="text-sm text-secondary">
          Uploaded videos are converted to 720p MP4. Longer limits mean more storage and longer processing. Videos shared as YouTube,
          Vimeo, Loom, TikTok or Dailymotion links are not limited.
        </p>
      </div>
      {saved && <FormNotice tone="success">Saved. New uploads use these limits; videos already posted are not affected.</FormNotice>}
      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          {FIELDS.map((f) => {
            const seconds = Number(draft[f.key]);
            return (
              <TextField
                key={f.key}
                label={f.label}
                name={f.key}
                type="number"
                inputMode="numeric"
                min={f.min}
                max={f.max}
                step={1}
                value={draft[f.key]}
                onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                hint={`${f.note} Seconds, ${f.min}–${f.max}${Number.isFinite(seconds) && seconds > 0 ? ` (${formatDuration(seconds)})` : ""}. Now: ${formatDuration(values[f.key])}.`}
                error={fieldErrors[f.key]}
              />
            );
          })}
        </div>
        {error && <FormNotice tone="error">{error}</FormNotice>}
        <div className="flex justify-end">
          <Button type="submit" size="small" disabled={busy} aria-busy={busy}>
            {busy ? "Saving…" : "Save limits"}
          </Button>
        </div>
      </form>
    </section>
  );
}
