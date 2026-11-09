"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import {
  OPPORTUNITY_LIMITS,
  OPPORTUNITY_TYPE_LABELS,
  OpportunityInput,
  OpportunityType,
  REMOTE_MODE_LABELS,
  RemoteMode,
  type OpportunityDetail,
} from "@chartermission/contracts";
import { Button, cn } from "@chartermission/ui";
import { Field, FormAlert, inputClasses } from "@/components/auth/fields";
import { ErrorNotice } from "@/components/social/errors";
import { toast } from "@/components/social/toast";
import { api, isApiError } from "@/lib/api/client";

type Option = { value: string; label: string };
type Values = {
  type: string;
  title: string;
  organisation: string;
  summary: string;
  description: string;
  remoteMode: string;
  countryCode: string;
  city: string;
  sectorId: string;
  deadline: string;
  compensation: string;
  moreInfoUrl: string;
};

const selectClasses = (invalid: boolean) => inputClasses(invalid, "cursor-pointer appearance-none");

function initialValues(o?: OpportunityDetail): Values {
  return {
    type: o?.type ?? "employment",
    title: o?.title ?? "",
    organisation: o?.organisation ?? "",
    summary: o?.summary ?? "",
    description: o?.description ?? "",
    remoteMode: o?.remoteMode ?? "remote",
    countryCode: o?.countryCode ?? "",
    city: o?.city ?? "",
    sectorId: o?.sectorId ?? "",
    deadline: o?.deadline ?? "",
    compensation: o?.compensation ?? "",
    moreInfoUrl: o?.moreInfoUrl ?? "",
  };
}

/** Create or edit a listing. It goes live as soon as it's saved. */
export function OpportunityForm({ opportunity, countries, sectors }: { opportunity?: OpportunityDetail; countries: Option[]; sectors: Option[] }) {
  const router = useRouter();
  const [values, setValues] = useState<Values>(() => initialValues(opportunity));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const set = (key: keyof Values) => (e: { target: { value: string } }) => {
    setValues((v) => ({ ...v, [key]: e.target.value }));
    if (errors[key])
      setErrors((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
  };
  const today = new Date().toISOString().slice(0, 10);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setServerError(null);
    const payload = {
      ...values,
      countryCode: values.countryCode || null,
      city: values.city.trim() || null,
      sectorId: values.sectorId || null,
      deadline: values.deadline || null,
      compensation: values.compensation.trim() || null,
      moreInfoUrl: values.moreInfoUrl.trim() || null,
    };
    const parsed = OpportunityInput.safeParse(payload);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? "");
        if (key && !next[key]) next[key] = issue.message;
      }
      setErrors(next);
      document.getElementById(`opp-${Object.keys(next)[0]}`)?.focus();
      return;
    }
    setBusy(true);
    try {
      const saved = opportunity
        ? await api<OpportunityDetail>(`/opportunities/${opportunity.id}`, { method: "PATCH", body: payload })
        : await api<OpportunityDetail>("/opportunities", { method: "POST", body: payload });
      toast.success(opportunity ? "Listing updated" : "Your opportunity is live");
      router.push(`/opportunities/${saved.slug}`);
      router.refresh();
    } catch (e) {
      if (isApiError(e, "VALIDATION_FAILED") && e.fields) setErrors(e.fields);
      setServerError(e);
      setBusy(false);
    }
  }

  const err = (key: keyof Values) => errors[key];
  const needsCountry = values.remoteMode !== "remote";

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5 rounded-card border border-line bg-card p-6 max-sm:p-4">
      {!opportunity && (
        <FormAlert tone="info" icon="briefcase">
          Listings go live straight away. Members apply inside Charter Mission with their profile and a short note, and you review applicants from the listing.
        </FormAlert>
      )}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Field id="opp-type" label="Type" error={err("type")}>
          <select id="opp-type" value={values.type} onChange={set("type")} className={selectClasses(!!err("type"))}>
            {OpportunityType.options.map((t) => (
              <option key={t} value={t}>
                {OPPORTUNITY_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </Field>
        <Field id="opp-organisation" label="Organisation" error={err("organisation")}>
          <input id="opp-organisation" value={values.organisation} onChange={set("organisation")} maxLength={OPPORTUNITY_LIMITS.organisation} className={inputClasses(!!err("organisation"))} />
        </Field>
      </div>
      <Field id="opp-title" label="Title" error={err("title")}>
        <input id="opp-title" value={values.title} onChange={set("title")} maxLength={OPPORTUNITY_LIMITS.title} placeholder="e.g. Product Designer, Fintech" className={inputClasses(!!err("title"))} />
      </Field>
      <Field id="opp-summary" label="One-line summary" hint={<span className="text-xs text-secondary">{values.summary.length} / {OPPORTUNITY_LIMITS.summary}</span>} error={err("summary")}>
        <input id="opp-summary" value={values.summary} onChange={set("summary")} maxLength={OPPORTUNITY_LIMITS.summary} className={inputClasses(!!err("summary"))} />
      </Field>
      <Field id="opp-description" label="Description" hint={<span className="text-xs text-secondary">What the role involves, who it suits, how you’ll choose</span>} error={err("description")}>
        <textarea
          id="opp-description"
          value={values.description}
          onChange={set("description")}
          maxLength={OPPORTUNITY_LIMITS.description}
          rows={10}
          className={cn(inputClasses(!!err("description")), "h-auto py-2.5")}
        />
      </Field>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
        <Field id="opp-remoteMode" label="Work mode" error={err("remoteMode")}>
          <select id="opp-remoteMode" value={values.remoteMode} onChange={set("remoteMode")} className={selectClasses(!!err("remoteMode"))}>
            {RemoteMode.options.map((m) => (
              <option key={m} value={m}>
                {REMOTE_MODE_LABELS[m]}
              </option>
            ))}
          </select>
        </Field>
        <Field id="opp-countryCode" label={needsCountry ? "Country" : "Country (optional)"} error={err("countryCode")}>
          <select id="opp-countryCode" value={values.countryCode} onChange={set("countryCode")} className={selectClasses(!!err("countryCode"))}>
            <option value="">{needsCountry ? "Choose a country" : "Anywhere"}</option>
            {countries.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </Field>
        <Field id="opp-city" label="City (optional)" error={err("city")}>
          <input id="opp-city" value={values.city} onChange={set("city")} maxLength={OPPORTUNITY_LIMITS.city} className={inputClasses(!!err("city"))} />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
        <Field id="opp-sectorId" label="Sector (optional)" error={err("sectorId")}>
          <select id="opp-sectorId" value={values.sectorId} onChange={set("sectorId")} className={selectClasses(!!err("sectorId"))}>
            <option value="">No sector</option>
            {sectors.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>
        <Field id="opp-deadline" label="Deadline (optional)" error={err("deadline")}>
          <input id="opp-deadline" type="date" min={today} value={values.deadline} onChange={set("deadline")} className={inputClasses(!!err("deadline"))} />
        </Field>
        <Field id="opp-compensation" label="Pay or award (optional)" error={err("compensation")}>
          <input id="opp-compensation" value={values.compensation} onChange={set("compensation")} maxLength={OPPORTUNITY_LIMITS.compensation} placeholder="e.g. $40k–55k, or Fully funded" className={inputClasses(!!err("compensation"))} />
        </Field>
      </div>

      <Field id="opp-moreInfoUrl" label="More information link (optional)" error={err("moreInfoUrl")}>
        <input id="opp-moreInfoUrl" type="url" inputMode="url" value={values.moreInfoUrl} onChange={set("moreInfoUrl")} placeholder="https://" className={inputClasses(!!err("moreInfoUrl"))} />
      </Field>

      {serverError && !Object.keys(errors).length ? <ErrorNotice error={serverError} /> : null}
      <div className="flex flex-wrap gap-3">
        <Button type="submit" aria-disabled={busy}>
          {busy ? "Saving…" : opportunity ? "Save changes" : "Publish opportunity"}
        </Button>
        <Button type="button" variant="secondary" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
