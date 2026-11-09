"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import type { LearningAccessRules } from "@chartermission/contracts";
import { Button, cn } from "@chartermission/ui";
import { FormNotice, TextField } from "@/components/form-field";
import { ApiError, api, errorMessage } from "@/lib/api/client";

type Toggle = { key: "requireProfileInfo" | "requirePhoto" | "requireCoverPhoto" | "requireChapter"; label: string; note: string };
type Count = { key: "minPosts" | "minConnections"; label: string; note: string; max: number };

const TOGGLES: Toggle[] = [
  {
    key: "requireProfileInfo",
    label: "Profile information filled in",
    note: "Headline, country, city, about, organisation, skills, sectors, interests, languages and experience.",
  },
  { key: "requirePhoto", label: "Profile photo", note: "A photo uploaded on the profile." },
  { key: "requireCoverPhoto", label: "Cover photo", note: "The wide banner at the top of the profile." },
  { key: "requireChapter", label: "Joined a chapter", note: "Follows at least one country chapter." },
];

const COUNTS: Count[] = [
  { key: "minPosts", label: "Posts shared", note: "Published posts of their own. Reposts don’t count.", max: 100 },
  { key: "minConnections", label: "Connections", note: "Accepted connections with other members.", max: 5000 },
];

function Checkbox({ checked, onChange, label, note, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; note?: string; disabled?: boolean }) {
  return (
    <label className={cn("flex items-start gap-3 rounded-lg border border-line px-3 py-2.5", disabled ? "opacity-60" : "cursor-pointer hover:bg-muted/40")}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 size-4 shrink-0 accent-primary" />
      <span className="flex flex-col gap-0.5">
        <span className="text-sm font-medium text-ink">{label}</span>
        {note && <span className="text-xs text-secondary">{note}</span>}
      </span>
    </label>
  );
}

/**
 * E-learning access rules (PUT /admin/settings/learning-access). Platform Admins; audited.
 * Learning stays locked for a member until they meet every rule switched on here.
 */
export function LearningAccessForm({ initial }: { initial: LearningAccessRules }) {
  const [rules, setRules] = useState(initial);
  const [counts, setCounts] = useState({ minPosts: String(initial.minPosts), minConnections: String(initial.minConnections) });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof LearningAccessRules, string>>>({});
  const [saved, setSaved] = useState(false);
  const off = !rules.enabled;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const errors: Partial<Record<keyof LearningAccessRules, string>> = {};
    const next: LearningAccessRules = { ...rules };
    for (const c of COUNTS) {
      const value = Number(counts[c.key]);
      if (counts[c.key].trim() === "" || !Number.isInteger(value) || value < 0 || value > c.max) errors[c.key] = `Enter a whole number from 0 to ${c.max.toLocaleString("en-US")}`;
      next[c.key] = value;
    }
    setFieldErrors(errors);
    setError(null);
    setSaved(false);
    if (Object.keys(errors).length) return;
    setBusy(true);
    try {
      const result = await api<LearningAccessRules>("/admin/settings/learning-access", { method: "PUT", body: next });
      setRules(result);
      setCounts({ minPosts: String(result.minPosts), minConnections: String(result.minConnections) });
      setSaved(true);
    } catch (e) {
      if (e instanceof ApiError && e.fields) setFieldErrors(e.fields as Partial<Record<keyof LearningAccessRules, string>>);
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="learning-rules" className="flex flex-col gap-4 rounded-card border border-line bg-card px-5 py-4">
      <div className="flex flex-col gap-1">
        <h2 id="learning-rules" className="text-h3 text-ink">
          Unlock rules
        </h2>
        <p className="text-sm text-secondary">
          Members see a checklist on the Learning page until they meet every rule switched on below. Staff accounts and members you unlock
          further down are never locked out.
        </p>
      </div>
      {saved && <FormNotice tone="success">Saved. Members’ Learning access updates straight away.</FormNotice>}
      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
        <Checkbox
          checked={rules.enabled}
          onChange={(v) => setRules((r) => ({ ...r, enabled: v }))}
          label="Lock Learning until these rules are met"
          note="Switch off to open Learning to every member. The rules are kept for when you switch it back on."
        />
        <fieldset disabled={off} className="flex flex-col gap-3">
          <legend className="mb-2 text-label uppercase text-secondary">Profile and community</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {TOGGLES.map((t) => (
              <Checkbox key={t.key} checked={rules[t.key]} disabled={off} onChange={(v) => setRules((r) => ({ ...r, [t.key]: v }))} label={t.label} note={t.note} />
            ))}
          </div>
        </fieldset>
        <fieldset disabled={off} className="flex flex-col gap-3">
          <legend className="mb-2 text-label uppercase text-secondary">Activity (0 = not required)</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            {COUNTS.map((c) => (
              <TextField
                key={c.key}
                label={c.label}
                name={c.key}
                type="number"
                inputMode="numeric"
                min={0}
                max={c.max}
                step={1}
                value={counts[c.key]}
                onChange={(e) => setCounts((d) => ({ ...d, [c.key]: e.target.value }))}
                hint={`${c.note} At least this many.`}
                error={fieldErrors[c.key]}
              />
            ))}
          </div>
        </fieldset>
        {error && <FormNotice tone="error">{error}</FormNotice>}
        <div className="flex justify-end">
          <Button type="submit" size="small" disabled={busy} aria-busy={busy}>
            {busy ? "Saving…" : "Save rules"}
          </Button>
        </div>
      </form>
    </section>
  );
}
