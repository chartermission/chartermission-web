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
import { Button, Icon, cn, type IconName } from "@chartermission/ui";
import { Field, FormAlert, inputClasses } from "@/components/auth/fields";
import { ErrorNotice } from "@/components/social/errors";
import { toast } from "@/components/social/toast";
import { api, isApiError } from "@/lib/api/client";
import { applyUrlForInput } from "./apply-link";

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
  /** "in_app": members apply in Charter Mission; "external": on the organisation's site or by email. */
  applyMode: "in_app" | "external";
  applyUrl: string;
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
    applyMode: o?.applyUrl ? "external" : "in_app",
    applyUrl: applyUrlForInput(o?.applyUrl),
  };
}

function ChoiceCard({ name, value, checked, onChange, title, description, icon, id }: { name: string; value: string; checked: boolean; onChange: () => void; title: string; description: string; icon: IconName; id?: string }) {
  return (
    <label
      className={cn(
        "relative flex cursor-pointer items-start gap-3 rounded-card border p-3.5 transition-colors has-focus-visible:ring-2 has-focus-visible:ring-primary-light/30",
        checked ? "border-primary bg-primary-tint-2" : "border-line bg-card hover:border-line-strong",
      )}
    >
      <input id={id} type="radio" name={name} value={value} checked={checked} onChange={onChange} className="sr-only" />
      <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", checked ? "bg-primary text-inverse" : "bg-muted text-secondary")}>
        <Icon name={icon} size={16} />
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-medium text-ink">{title}</span>
        <span className="text-xs text-secondary">{description}</span>
      </span>
      <span aria-hidden="true" className={cn("ms-auto mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border", checked ? "border-primary bg-primary" : "border-line-strong bg-card")}>
        {checked && <span className="size-1.5 rounded-full bg-card" />}
      </span>
    </label>
  );
}

/** Create or edit a listing. It goes live as soon as it's saved. */
export function OpportunityForm({ opportunity, countries, sectors }: { opportunity?: OpportunityDetail; countries: Option[]; sectors: Option[] }) {
  const router = useRouter();
  const [values, setValues] = useState<Values>(() => initialValues(opportunity));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  // Create only: also share the new listing to the member's feed (on by default).
  const [shareToFeed, setShareToFeed] = useState(true);
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
    const { applyMode, applyUrl, ...fields } = values;
    const external = applyMode === "external";
    const payload = {
      ...fields,
      applyUrl: external ? applyUrl.trim() || null : null,
      ...(opportunity ? {} : { shareToFeed }),
      countryCode: values.countryCode || null,
      city: values.city.trim() || null,
      sectorId: values.sectorId || null,
      deadline: values.deadline || null,
      compensation: values.compensation.trim() || null,
      moreInfoUrl: values.moreInfoUrl.trim() || null,
    };
    const parsed = OpportunityInput.safeParse(payload);
    const missingLink = external && !payload.applyUrl;
    if (!parsed.success || missingLink) {
      const next: Record<string, string> = {};
      for (const issue of parsed.success ? [] : parsed.error.issues) {
        const key = String(issue.path[0] ?? "");
        if (key && !next[key]) next[key] = issue.message;
      }
      if (missingLink) next.applyUrl = "Enter a link starting with https:// or an email address";
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
          {values.applyMode === "external"
            ? "Listings go live straight away. Members apply on your site or by email, using the link you give."
            : "Listings go live straight away. Members apply inside Charter Mission with their profile and a short note, and you review applicants from the listing."}
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

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-3 text-sm font-medium text-ink">How do people apply?</legend>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <ChoiceCard
            id="opp-applyMode"
            name="applyMode"
            value="in_app"
            checked={values.applyMode === "in_app"}
            onChange={() => set("applyMode")({ target: { value: "in_app" } })}
            title="In Charter Mission"
            description="Members apply with their profile and a short note, and you review applicants here."
            icon="users"
          />
          <ChoiceCard
            name="applyMode"
            value="external"
            checked={values.applyMode === "external"}
            onChange={() => set("applyMode")({ target: { value: "external" } })}
            title="On your site or by email"
            description="Members go to your link or write to your email address."
            icon="external"
          />
        </div>
        {values.applyMode === "external" && (
          <Field id="opp-applyUrl" label="Application link or email" error={err("applyUrl")}>
            <input
              id="opp-applyUrl"
              type="text"
              inputMode="url"
              autoComplete="off"
              value={values.applyUrl}
              onChange={set("applyUrl")}
              placeholder="https://… or jobs@example.org"
              className={inputClasses(!!err("applyUrl"))}
            />
          </Field>
        )}
      </fieldset>

      {!opportunity && (
        <label className="flex cursor-pointer items-start gap-2.5 text-sm text-body">
          <input id="opp-shareToFeed" type="checkbox" checked={shareToFeed} onChange={(e) => setShareToFeed(e.target.checked)} className="mt-0.5 size-4 shrink-0 accent-primary" />
          <span className="flex flex-col gap-0.5">
            <span className="font-medium text-ink">Share to your feed</span>
            <span className="text-xs text-secondary">Your followers and connections see it in their feed.</span>
          </span>
        </label>
      )}

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
