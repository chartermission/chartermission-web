"use client";

import { useState, type FormEvent } from "react";
import { GROUPS_OWNED_MAX, type GroupsSettings } from "@chartermission/contracts";
import { Button } from "@chartermission/ui";
import { Field, selectClasses } from "@/components/ambassadors/modal";
import { FormNotice, TextField } from "@/components/form-field";
import { ApiError, api, errorMessage } from "@/lib/api/client";
import { useT } from "@/i18n/client";

const WHO_OPTIONS: { value: GroupsSettings["whoCanCreate"]; label: string }[] = [
  { value: "everyone", label: "Everyone" },
  { value: "verified", label: "Verified members only" },
  { value: "staff", label: "Staff only" },
];

/** Who can create groups and how many one member may own (PUT /admin/settings/groups). Platform Admins only; audited. */
export function GroupsSettingsForm({ initial }: { initial: GroupsSettings }) {
  const t = useT();
  const [who, setWho] = useState(initial.whoCanCreate);
  const [max, setMax] = useState(String(initial.maxOwnedPerMember));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSaved(false);
    const value = Number(max);
    if (max.trim() === "" || !Number.isInteger(value) || value < 1 || value > GROUPS_OWNED_MAX) {
      setFieldError(t("Enter a whole number from {min} to {max}", { min: 1, max: GROUPS_OWNED_MAX }));
      return;
    }
    setFieldError(null);
    setBusy(true);
    try {
      const result = await api<GroupsSettings>("/admin/settings/groups", { method: "PUT", body: { whoCanCreate: who, maxOwnedPerMember: value } satisfies GroupsSettings });
      setWho(result.whoCanCreate);
      setMax(String(result.maxOwnedPerMember));
      setSaved(true);
    } catch (e) {
      if (e instanceof ApiError && e.fields?.maxOwnedPerMember) setFieldError(e.fields.maxOwnedPerMember);
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="groups" aria-labelledby="groups-settings" className="flex scroll-mt-20 flex-col gap-4 rounded-card border border-line bg-card px-5 py-4">
      <div className="flex flex-col gap-1">
        <h2 id="groups-settings" className="text-h3 text-ink">
          Groups
        </h2>
        <p className="text-sm text-secondary">Who can start a group, and how many groups one member can own. Groups that already exist stay as they are.</p>
      </div>
      {saved && <FormNotice tone="success">Saved. New groups follow these rules from now on.</FormNotice>}
      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Who can create groups">
            {(id, describedBy) => (
              <select
                id={id}
                aria-describedby={describedBy}
                value={who}
                onChange={(e) => {
                  setWho(e.target.value as GroupsSettings["whoCanCreate"]);
                  setSaved(false);
                }}
                className={selectClasses()}
              >
                {WHO_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <TextField
            label="Groups one member can own"
            name="maxOwnedPerMember"
            type="number"
            inputMode="numeric"
            min={1}
            max={GROUPS_OWNED_MAX}
            step={1}
            value={max}
            onChange={(e) => {
              setMax(e.target.value);
              setSaved(false);
            }}
            hint={t("From 1 to {max}. Groups run by a page or chapter don’t count.", { max: GROUPS_OWNED_MAX })}
            error={fieldError}
          />
        </div>
        {error && <FormNotice tone="error">{error}</FormNotice>}
        <div className="flex justify-end">
          <Button type="submit" size="small" disabled={busy} aria-busy={busy}>
            {busy ? "Saving…" : "Save group rules"}
          </Button>
        </div>
      </form>
    </section>
  );
}
