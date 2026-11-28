"use client";

import { useState } from "react";
import {
  CSV_REMOTE_MODES,
  OPPORTUNITY_LIMITS,
  OPPORTUNITY_TYPE_LABELS,
  REMOTE_MODE_LABELS,
  type Country,
  type OpportunityCsvColumn,
  type OpportunityImportRowResult,
  type RemoteMode,
  type TaxonomyItem,
} from "@chartermission/contracts";
import { Field, FormModal, SelectBox } from "@/components/ambassadors/modal";
import { TextField, inputClasses } from "@/components/form-field";
import { useT } from "@/i18n/client";
import type { ImportRecord } from "@/lib/opportunity-import";

export type ReviewRow = ImportRecord & { result: OpportunityImportRowResult | null; checked: boolean };

const fold = (v: string | undefined) => (v ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");

/** The form's starting values: the normalised listing when the row is valid, otherwise the CSV cells matched to the lists. */
function initialValues(row: ReviewRow, countries: Country[], sectors: TaxonomyItem[]): Record<OpportunityCsvColumn, string> {
  const v = row.values;
  const input = row.result?.input ?? null;
  const typeKey = input?.type ?? Object.entries(OPPORTUNITY_TYPE_LABELS).find(([key, label]) => fold(v.type) === key || fold(v.type) === fold(label))?.[0] ?? "";
  const rawMode = fold(v.remote_mode);
  const mode = input
    ? CSV_REMOTE_MODES[input.remoteMode]
    : rawMode === "remote" || rawMode === "hybrid"
      ? rawMode
      : ["on_site", "onsite", "in_person", "in-person"].includes(rawMode)
        ? "on_site"
        : "";
  const rawCountry = (v.country ?? "").trim();
  const country =
    input?.countryCode ??
    countries.find((c) => c.code === rawCountry.toUpperCase() || c.name.toLowerCase() === rawCountry.toLowerCase())?.code ??
    "";
  const sector = input?.sectorId
    ? (sectors.find((s) => s.id === input.sectorId)?.name ?? "")
    : (sectors.find((s) => s.name.toLowerCase() === (v.sector ?? "").trim().toLowerCase() || s.slug === (v.sector ?? "").trim().toLowerCase())?.name ?? "");
  const deadline = input?.deadline ?? (/^\d{4}-\d{2}-\d{2}/.exec(v.deadline ?? "")?.[0] || "");
  return {
    type: typeKey,
    title: input?.title ?? v.title ?? "",
    organisation: input?.organisation ?? v.organisation ?? "",
    summary: input?.summary ?? v.summary ?? "",
    description: input?.description ?? v.description ?? "",
    remote_mode: mode,
    country,
    city: input?.city ?? v.city ?? "",
    sector,
    deadline,
    compensation: input?.compensation ?? v.compensation ?? "",
    apply_link: input?.applyUrl?.replace(/^mailto:/, "") ?? v.apply_link ?? "",
    more_info_url: input?.moreInfoUrl ?? v.more_info_url ?? "",
  };
}

/**
 * Edit one imported row with a proper form. Saving sends every row back through the API's dry run
 * (so duplicates across rows are checked again); the dialog stays open while the row has problems.
 */
export function ImportRowEditor({
  row,
  countries,
  sectors,
  onSave,
  onClose,
}: {
  row: ReviewRow;
  countries: Country[];
  sectors: TaxonomyItem[];
  /** Returns the row's new check (null when the request failed: the error is shown in a toast). */
  onSave: (values: Record<OpportunityCsvColumn, string>) => Promise<OpportunityImportRowResult | null>;
  onClose: () => void;
}) {
  const t = useT();
  const [start] = useState(() => initialValues(row, countries, sectors));
  const [errors, setErrors] = useState(row.result?.errors ?? {});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(data: FormData) {
    const values = Object.fromEntries(Object.keys(start).map((k) => [k, String(data.get(k) ?? "").trim()])) as Record<OpportunityCsvColumn, string>;
    setBusy(true);
    setNotice(null);
    try {
      const result = await onSave(values);
      if (!result) return;
      if (result.input) onClose();
      else {
        setErrors(result.errors);
        setNotice(result.errors.row ?? t("Fix the highlighted fields to post this opportunity."));
      }
    } finally {
      setBusy(false);
    }
  }

  const err = (c: OpportunityCsvColumn) => errors[c] ?? null;
  return (
    <FormModal title={t("Edit row {row}", { row: row.row })} description="Changes are checked again when you save." submitLabel="Save and check" busy={busy} error={notice} wide onSubmit={(d) => void submit(d)} onClose={onClose}>
      <div className="grid max-h-[62dvh] grid-cols-1 gap-4 overflow-y-auto pe-1 sm:grid-cols-2">
        <Field label="Type" error={err("type")}>
          {(id, describedBy) => (
            <SelectBox
              id={id}
              name="type"
              defaultValue={start.type}
              invalid={!!err("type")}
              describedBy={describedBy}
              options={[{ value: "", label: t("Choose a type") }, ...Object.entries(OPPORTUNITY_TYPE_LABELS).map(([value, label]) => ({ value, label: t(label) }))]}
            />
          )}
        </Field>
        <Field label="Work mode" error={err("remote_mode")}>
          {(id, describedBy) => (
            <SelectBox
              id={id}
              name="remote_mode"
              defaultValue={start.remote_mode}
              invalid={!!err("remote_mode")}
              describedBy={describedBy}
              options={[
                { value: "", label: t("Not given") },
                ...(Object.entries(CSV_REMOTE_MODES) as [RemoteMode, string][]).map(([mode, value]) => ({ value, label: t(REMOTE_MODE_LABELS[mode]) })),
              ]}
            />
          )}
        </Field>
        <TextField label="Title" name="title" defaultValue={start.title} maxLength={OPPORTUNITY_LIMITS.title} error={err("title")} className="sm:col-span-2" dir="auto" />
        <TextField label="Organisation" name="organisation" defaultValue={start.organisation} maxLength={OPPORTUNITY_LIMITS.organisation} error={err("organisation")} dir="auto" />
        <TextField label="Apply link or email" name="apply_link" defaultValue={start.apply_link} error={err("apply_link")} hint="Optional. A link starting with https:// or an email address. Leave it empty to take applications in Charter Mission." dir="ltr" />
        <Field label="Summary" hint={t("One line, up to {max} characters.", { max: OPPORTUNITY_LIMITS.summary })} error={err("summary")}>
          {(id, describedBy) => (
            <textarea id={id} name="summary" rows={2} defaultValue={start.summary} maxLength={OPPORTUNITY_LIMITS.summary + 40} aria-describedby={describedBy} aria-invalid={!!err("summary") || undefined} className={inputClasses(!!err("summary"))} dir="auto" />
          )}
        </Field>
        <Field label="Deadline" hint="Leave empty if there is none." error={err("deadline")}>
          {(id, describedBy) => <input id={id} name="deadline" type="date" defaultValue={start.deadline} aria-describedby={describedBy} aria-invalid={!!err("deadline") || undefined} className={inputClasses(!!err("deadline"))} />}
        </Field>
        <div className="sm:col-span-2">
          <Field label="Description" hint={t("{min}–{max} characters: the role, eligibility, benefits and how to apply.", { min: 30, max: OPPORTUNITY_LIMITS.description.toLocaleString("en-GB") })} error={err("description")}>
            {(id, describedBy) => (
              <textarea id={id} name="description" rows={7} defaultValue={start.description} maxLength={OPPORTUNITY_LIMITS.description} aria-describedby={describedBy} aria-invalid={!!err("description") || undefined} className={inputClasses(!!err("description"))} dir="auto" />
            )}
          </Field>
        </div>
        <Field label="Country" hint="Needed for on-site and hybrid opportunities." error={err("country")}>
          {(id, describedBy) => (
            <SelectBox
              id={id}
              name="country"
              defaultValue={start.country}
              invalid={!!err("country")}
              describedBy={describedBy}
              options={[{ value: "", label: t("No country") }, ...countries.map((c) => ({ value: c.code, label: c.name }))]}
            />
          )}
        </Field>
        <TextField label="City" name="city" defaultValue={start.city} maxLength={OPPORTUNITY_LIMITS.city} error={err("city")} hint="Optional" dir="auto" />
        <Field label="Sector" error={err("sector")}>
          {(id, describedBy) => (
            <SelectBox id={id} name="sector" defaultValue={start.sector} describedBy={describedBy} options={[{ value: "", label: t("No sector") }, ...sectors.map((s) => ({ value: s.name, label: s.name }))]} />
          )}
        </Field>
        <TextField label="Compensation" name="compensation" defaultValue={start.compensation} maxLength={OPPORTUNITY_LIMITS.compensation} error={err("compensation")} hint="Optional" dir="auto" />
        <TextField label="More information link" name="more_info_url" defaultValue={start.more_info_url} error={err("more_info_url")} hint="Optional" dir="ltr" />
      </div>
    </FormModal>
  );
}
