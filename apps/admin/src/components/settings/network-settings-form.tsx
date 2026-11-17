"use client";

import { useState, type FormEvent } from "react";
import type { NetworkSettings } from "@chartermission/contracts";
import { Button } from "@chartermission/ui";
import { FormNotice, TextField } from "@/components/form-field";
import { ApiError, api, errorMessage } from "@/lib/api/client";
import { useT } from "@/i18n/client";

const MIN = 1;
const MAX = 10_000;
/** Shown in the field when "No limit" is unticked and there was no limit before. */
const SUGGESTED = 50;

/**
 * Networking limits (PUT /admin/settings/network). Platform Admins only; audited. No limit by default.
 * A limit applies at once and counts the requests a member already sent in the last 24 hours.
 */
export function NetworkSettingsForm({ initial }: { initial: NetworkSettings }) {
  const t = useT();
  const [values, setValues] = useState(initial);
  const [unlimited, setUnlimited] = useState(initial.dailyConnectionRequestLimit === null);
  const [draft, setDraft] = useState(String(initial.dailyConnectionRequestLimit ?? SUGGESTED));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSaved(false);
    let limit: number | null = null;
    if (!unlimited) {
      const value = Number(draft);
      if (draft.trim() === "" || !Number.isInteger(value) || value < MIN || value > MAX) {
        setFieldError(t("Enter a whole number from {min} to {max}", { min: MIN, max: MAX }));
        return;
      }
      limit = value;
    }
    setFieldError(null);
    setBusy(true);
    try {
      const result = await api<NetworkSettings>("/admin/settings/network", { method: "PUT", body: { dailyConnectionRequestLimit: limit } satisfies NetworkSettings });
      setValues(result);
      setUnlimited(result.dailyConnectionRequestLimit === null);
      if (result.dailyConnectionRequestLimit !== null) setDraft(String(result.dailyConnectionRequestLimit));
      setSaved(true);
    } catch (e) {
      if (e instanceof ApiError && e.fields?.dailyConnectionRequestLimit) setFieldError(e.fields.dailyConnectionRequestLimit);
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const now = values.dailyConnectionRequestLimit;

  return (
    <section aria-labelledby="connection-requests" className="flex flex-col gap-4 rounded-card border border-line bg-card px-5 py-4">
      <div className="flex flex-col gap-1">
        <h2 id="connection-requests" className="text-h3 text-ink">
          Connection requests
        </h2>
        <p className="text-sm text-secondary">
          A limit slows down members who send requests to people they don’t know. Members who reach it are told how many they can send and when they can try
          again.
        </p>
      </div>
      {saved && (
        <FormNotice tone="success">
          {now === null ? "Saved. Members can send as many connection requests as they like." : t("Saved. Members can send up to {count} connection requests in 24 hours.", { count: now })}
        </FormNotice>
      )}
      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <TextField
              label="Daily connection requests"
              name="dailyConnectionRequestLimit"
              type="number"
              inputMode="numeric"
              min={MIN}
              max={MAX}
              step={1}
              disabled={unlimited}
              value={unlimited ? "" : draft}
              placeholder={unlimited ? t("No limit") : undefined}
              onChange={(e) => {
                setDraft(e.target.value);
                setSaved(false);
              }}
              hint={t("How many connection requests a member can send in 24 hours. {min}–{max}. Now: {now}.", {
                min: MIN,
                max: MAX,
                now: now === null ? t("no limit") : now,
              })}
              error={fieldError}
            />
            <label className="flex cursor-pointer items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={unlimited}
                onChange={(e) => {
                  setUnlimited(e.target.checked);
                  setFieldError(null);
                  setSaved(false);
                }}
                className="size-4 accent-primary"
              />
              No limit
            </label>
          </div>
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
