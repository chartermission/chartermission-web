"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { TrendingRules } from "@chartermission/contracts";
import { Button } from "@chartermission/ui";
import { FormNotice, TextField } from "@/components/form-field";
import { ApiError, api, errorMessage } from "@/lib/api/client";

type Field = { key: keyof TrendingRules; label: string; note: string; min: number; max: number; unit: string };

const FIELDS: Field[] = [
  { key: "minDistinctAuthors", label: "Minimum distinct authors", note: "before a topic can trend", min: 1, max: 1000, unit: "authors" },
  { key: "maxPostsPerAuthorPerHour", label: "Max posts per author", note: "per hour, counted toward a trend", min: 1, max: 100, unit: "posts / hour" },
  { key: "baselineDays", label: "Baseline", note: "normal level compared against", min: 3, max: 60, unit: "days" },
  { key: "recomputeMinutes", label: "Recompute every", note: "how often rankings refresh", min: 1, max: 60, unit: "minutes" },
];

/**
 * Trending rules summary (Figma "Rules", node 20:3595). Platform Admins can edit them
 * (PUT /admin/trending/rules); the change is audited and triggers a recompute.
 */
export function TrendingRulesPanel({ rules, canEdit }: { rules: TrendingRules; canEdit: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof TrendingRules, string>>>({});
  const [saved, setSaved] = useState(false);
  const [, startRefresh] = useTransition();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const next = {} as TrendingRules;
    const errors: Partial<Record<keyof TrendingRules, string>> = {};
    for (const f of FIELDS) {
      const value = Number(data.get(f.key));
      if (!Number.isInteger(value) || value < f.min || value > f.max) errors[f.key] = `Enter a whole number from ${f.min} to ${f.max}`;
      next[f.key] = value;
    }
    setFieldErrors(errors);
    setError(null);
    if (Object.keys(errors).length) return;
    setBusy(true);
    try {
      await api<TrendingRules>("/admin/trending/rules", { method: "PUT", body: next });
      setEditing(false);
      setSaved(true);
      startRefresh(() => router.refresh());
    } catch (e) {
      if (e instanceof ApiError && e.fields) setFieldErrors(e.fields as Partial<Record<keyof TrendingRules, string>>);
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="trending-rules" className="flex flex-col gap-1 rounded-card border border-line bg-card px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="trending-rules" className="text-h3 text-ink">
          Rules
        </h2>
        {canEdit && !editing && (
          <Button
            variant="ghost"
            size="small"
            onClick={() => {
              setEditing(true);
              setSaved(false);
            }}
          >
            Edit rules
          </Button>
        )}
      </div>
      {saved && <FormNotice tone="success">Rules saved. Rankings recompute with the new rules shortly.</FormNotice>}
      {editing ? (
        <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4 pt-2">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {FIELDS.map((f) => (
              <TextField
                key={f.key}
                label={f.label}
                name={f.key}
                type="number"
                inputMode="numeric"
                min={f.min}
                max={f.max}
                step={1}
                defaultValue={rules[f.key]}
                hint={`${f.unit} · ${f.min}–${f.max}`}
                error={fieldErrors[f.key]}
              />
            ))}
          </div>
          {error && <FormNotice tone="error">{error}</FormNotice>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="small" disabled={busy} onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button type="submit" size="small" disabled={busy} aria-busy={busy}>
              {busy ? "Saving…" : "Save rules"}
            </Button>
          </div>
        </form>
      ) : (
        <dl className="grid grid-cols-2 xl:grid-cols-4">
          {FIELDS.map((f) => (
            <div key={f.key} className="flex min-w-0 flex-col gap-1 py-3 pr-4">
              <dt className="text-xs text-secondary">{f.label}</dt>
              <dd className="text-h3 text-ink">
                {rules[f.key]} <span className="text-sm font-normal text-secondary">{f.unit}</span>
              </dd>
              <dd className="text-xs text-disabled">{f.note}</dd>
            </div>
          ))}
        </dl>
      )}
      {!canEdit && <p className="text-xs text-secondary">Only Platform Admins can change the rules.</p>}
    </section>
  );
}
