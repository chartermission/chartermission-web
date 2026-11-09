"use client";

import { LEAD_SOURCE_LABELS, LeadSource, type AdminLeadDetail, type CountryRef, type TeamMember } from "@chartermission/contracts";
import { TextField, inputClasses } from "@/components/form-field";
import { Field, SelectBox } from "./modal";

/**
 * The lead's details, shared by "Add lead" and "Edit details". Read the values back with
 * leadInputFromForm(). `errors` are the API's field messages, keyed by input name.
 */
export function LeadFields({
  lead,
  countries,
  team,
  errors,
}: {
  lead?: AdminLeadDetail;
  countries: CountryRef[];
  team: TeamMember[];
  errors: Record<string, string>;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <TextField label="Full name" name="fullName" required maxLength={120} defaultValue={lead?.fullName} error={errors.fullName} autoComplete="off" />
      <TextField label="Email" name="email" type="email" required maxLength={254} defaultValue={lead?.email} error={errors.email} autoComplete="off" />
      <TextField label="Phone or WhatsApp" name="phone" maxLength={40} defaultValue={lead?.phone ?? ""} error={errors.phone} />
      <Field label="Country" error={errors.countryCode} hint="The country chapter they would lead (or the diaspora host country).">
        {(id, describedBy) => (
          <SelectBox
            id={id}
            name="countryCode"
            describedBy={describedBy}
            invalid={!!errors.countryCode}
            defaultValue={lead?.country.code ?? (countries.length === 1 ? countries[0]!.code : "")}
            options={[{ value: "", label: "Choose a country" }, ...countries.map((c) => ({ value: c.code, label: c.name }))]}
          />
        )}
      </Field>
      <TextField label="City" name="city" maxLength={80} defaultValue={lead?.city ?? ""} error={errors.city} />
      <TextField label="Organisation" name="organisation" maxLength={120} defaultValue={lead?.organisation ?? ""} error={errors.organisation} />
      <TextField label="Job title" name="jobTitle" maxLength={120} defaultValue={lead?.jobTitle ?? ""} error={errors.jobTitle} />
      <TextField label="LinkedIn" name="linkedinUrl" type="url" placeholder="https://linkedin.com/in/…" maxLength={500} defaultValue={lead?.linkedinUrl ?? ""} error={errors.linkedinUrl} />
      <Field label="Source" error={errors.source}>
        {(id) => (
          <SelectBox id={id} name="source" defaultValue={lead?.source ?? "outreach"} options={LeadSource.options.map((s) => ({ value: s, label: LEAD_SOURCE_LABELS[s] }))} />
        )}
      </Field>
      <TextField label="Referred or nominated by" name="referredBy" maxLength={120} defaultValue={lead?.referredBy ?? ""} error={errors.referredBy} />
      <TextField
        label="Hours per week they can give"
        name="hoursPerWeek"
        type="number"
        min={0}
        max={80}
        defaultValue={lead?.hoursPerWeek ?? ""}
        error={errors.hoursPerWeek}
        hint="At least 4 is expected."
      />
      <Field label="Owner" error={errors.ownerId} hint="The manager responsible for this lead.">
        {(id) => (
          <SelectBox
            id={id}
            name="ownerId"
            defaultValue={lead?.owner?.id ?? ""}
            options={[{ value: "", label: lead ? "Nobody" : "Me" }, ...team.map((m) => ({ value: m.id, label: m.name }))]}
          />
        )}
      </Field>
      <div className="sm:col-span-2">
        <Field label="Motivation and vision" error={errors.motivation} hint="Why they want to lead the chapter and what they would do in the first 90 days.">
          {(id, describedBy) => (
            <textarea id={id} name="motivation" rows={4} maxLength={3000} defaultValue={lead?.motivation ?? ""} aria-describedby={describedBy} className={inputClasses(!!errors.motivation, "resize-y")} />
          )}
        </Field>
      </div>
      <div className="sm:col-span-2">
        <Field label="Internal notes" error={errors.notes} hint="Only the ambassador team sees these.">
          {(id, describedBy) => (
            <textarea id={id} name="notes" rows={3} maxLength={3000} defaultValue={lead?.notes ?? ""} aria-describedby={describedBy} className={inputClasses(!!errors.notes, "resize-y")} />
          )}
        </Field>
      </div>
    </div>
  );
}

/**
 * Form values → the API body. On create, empty optional fields are left out; on edit they are
 * sent as null so a field can be cleared. ownerId "" means "me" on create, "nobody" on edit.
 */
export function leadInputFromForm(data: FormData, mode: "create" | "edit") {
  const text = (k: string) => String(data.get(k) ?? "").trim();
  const empty = mode === "edit" ? null : undefined;
  const opt = (k: string) => text(k) || empty;
  const hours = text("hoursPerWeek");
  const owner = text("ownerId");
  return {
    fullName: text("fullName"),
    email: text("email"),
    countryCode: text("countryCode"),
    source: text("source") as LeadSource,
    phone: opt("phone"),
    city: opt("city"),
    organisation: opt("organisation"),
    jobTitle: opt("jobTitle"),
    linkedinUrl: opt("linkedinUrl"),
    referredBy: opt("referredBy"),
    hoursPerWeek: hours === "" ? empty : Number(hours),
    motivation: opt("motivation"),
    notes: opt("notes"),
    ownerId: owner ? owner : empty,
  };
}
