"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { PAGE_CATEGORY_LABELS, PageCategory, PageInput, PageTeamSize, type PageDetail } from "@chartermission/contracts";
import { Button, Divider } from "@chartermission/ui";
import { CountrySelect } from "@/components/account/country-select";
import { Field, FormAlert, inputClasses } from "@/components/auth/fields";
import { ErrorNotice } from "@/components/social/errors";
import { pageHref } from "@/components/social/links";
import { toast } from "@/components/social/toast";
import { api, isApiError } from "@/lib/api/client";
import type { CountryGroup } from "@/lib/taxonomies";
import { useT } from "@/i18n/client";
import { SectorPicker, SpecialtiesInput, type SectorOption } from "./page-details-fields";
import { SOCIAL_NETWORKS, TEAM_SIZE_LABELS, withScheme, type SocialNetwork } from "./page-ref";
import { PagePictureField } from "./picture-field";

type Values = {
  name: string;
  tagline: string;
  about: string;
  category: string;
  website: string;
  countryCode: string;
  city: string;
  contactEmail: string;
  contactPhone: string;
  whatsapp: string;
  address: string;
  hours: string;
  foundedYear: string;
  teamSize: string;
};
type Picture = { fileId: string | null; url: string | null; changed: boolean };

const TAGLINE_MAX = 120;
const ABOUT_MAX = 2000;
const ADDRESS_MAX = 300;
const HOURS_MAX = 160;
const MAX_SECTORS = 3;
const MAX_SPECIALTIES = 10;
const SPECIALTY_MAX = 40;

function initialValues(page?: PageDetail): Values {
  return {
    name: page?.name ?? "",
    tagline: page?.tagline ?? "",
    about: page?.about ?? "",
    category: page?.category ?? "organisation",
    website: page?.website ?? "",
    countryCode: page?.country?.code ?? "",
    city: page?.city ?? "",
    contactEmail: page?.contactEmail ?? "",
    contactPhone: page?.contactPhone ?? "",
    whatsapp: page?.whatsapp ?? "",
    address: page?.address ?? "",
    hours: page?.hours ?? "",
    foundedYear: page?.foundedYear ? String(page.foundedYear) : "",
    teamSize: page?.teamSize ?? "",
  };
}

const emptySocial = (): Record<SocialNetwork, string> => ({ linkedin: "", x: "", facebook: "", instagram: "", youtube: "" });

/** Where an issue's message is shown: social links per network, everything else by its top-level field. */
function errorKey(path: readonly PropertyKey[]): string {
  const [first, second] = path;
  if (first === "socialLinks" && second !== undefined) return `socialLinks.${String(second)}`;
  return String(first ?? "");
}

/**
 * Create a page, or edit one. Pages go live as soon as they're created. If staff have switched
 * new pages to review, the API answers with status "pending" and we say so after saving.
 */
export function PageForm({ page, countries, sectors }: { page?: PageDetail; countries: CountryGroup[]; sectors: SectorOption[] }) {
  const t = useT();
  const router = useRouter();
  const [values, setValues] = useState<Values>(() => initialValues(page));
  const [sectorIds, setSectorIds] = useState<string[]>(() => page?.sectors.map((s) => s.id) ?? []);
  const [specialties, setSpecialties] = useState<string[]>(() => page?.specialties ?? []);
  const [social, setSocial] = useState<Record<SocialNetwork, string>>(() => {
    const links = emptySocial();
    for (const { key } of SOCIAL_NETWORKS) links[key] = page?.socialLinks[key] ?? "";
    return links;
  });
  const [logo, setLogo] = useState<Picture>({ fileId: null, url: page?.logoUrl ?? null, changed: false });
  const [cover, setCover] = useState<Picture>({ fileId: null, url: page?.coverUrl ?? null, changed: false });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const clearError = (key: string) => {
    if (errors[key])
      setErrors((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
  };

  const set = (key: keyof Values) => (event: { target: { value: string } }) => {
    setValues((current) => ({ ...current, [key]: event.target.value }));
    clearError(key);
  };

  function focusFirst(next: Record<string, string>) {
    document.getElementById(`page-${Object.keys(next)[0]}`)?.focus();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setServerError(null);
    const year = values.foundedYear.trim();
    const payload = {
      name: values.name,
      tagline: values.tagline.trim() || null,
      about: values.about.trim() || null,
      category: values.category,
      website: withScheme(values.website),
      countryCode: values.countryCode || null,
      city: values.city.trim() || null,
      contactEmail: values.contactEmail.trim() || null,
      contactPhone: values.contactPhone.trim() || null,
      whatsapp: values.whatsapp.trim() || null,
      address: values.address.trim() || null,
      hours: values.hours.trim() || null,
      foundedYear: year && /^\d{4}$/.test(year) ? Number(year) : null,
      teamSize: values.teamSize || null,
      sectorIds,
      specialties,
      socialLinks: Object.fromEntries(SOCIAL_NETWORKS.map(({ key }) => [key, withScheme(social[key])])),
      ...(logo.changed ? { logoFileId: logo.fileId } : {}),
      ...(cover.changed ? { coverFileId: cover.fileId } : {}),
    };
    const next: Record<string, string> = {};
    const parsed = PageInput.safeParse(payload);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const key = errorKey(issue.path);
        if (key && !next[key]) next[key] = issue.message;
      }
    }
    const currentYear = new Date().getFullYear();
    if (year && (!/^\d{4}$/.test(year) || Number(year) < 1800 || Number(year) > currentYear)) next.foundedYear = t("Enter a year between 1800 and {year}", { year: currentYear });
    else if (next.foundedYear) next.foundedYear = t("Enter a year between 1800 and {year}", { year: currentYear });
    if (Object.keys(next).length) {
      setErrors(next);
      focusFirst(next);
      return;
    }
    setBusy(true);
    try {
      const saved = page
        ? await api<PageDetail>(`/pages/${page.slug}`, { method: "PATCH", body: payload })
        : await api<PageDetail>("/pages", { method: "POST", body: payload });
      toast.success(
        page
          ? page.status === "rejected"
            ? "Saved and sent back for review"
            : "Page updated"
          : saved.status === "pending"
            ? "Page created. We’ll review it and let you know when it’s live."
            : "Your page is live",
      );
      router.push(pageHref(saved.slug));
      router.refresh();
    } catch (error) {
      setBusy(false);
      if (isApiError(error) && error.fields) {
        setErrors(error.fields);
        focusFirst(error.fields);
      } else setServerError(error);
    }
  }

  const counter = (n: number, max: number) => (
    <span className="text-xs text-secondary">
      {n} / {max}
    </span>
  );

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      {page?.status === "rejected" && (
        <FormAlert tone="warning">
          This page wasn’t approved{page.reviewNote ? `: “${page.reviewNote}”` : ""}. Saving your changes sends it back for review.
        </FormAlert>
      )}
      {serverError !== null && <ErrorNotice error={serverError} />}

      <Field id="page-name" label="Page name" error={errors.name}>
        <input
          id="page-name"
          value={values.name}
          onChange={set("name")}
          maxLength={80}
          required
          autoComplete="organization"
          placeholder="The organisation’s name, as people know it"
          aria-invalid={errors.name ? true : undefined}
          className={inputClasses(!!errors.name)}
        />
      </Field>

      <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
        <Field id="page-category" label="What kind of page is it?" error={errors.category}>
          <select id="page-category" value={values.category} onChange={set("category")} className={inputClasses(!!errors.category, "cursor-pointer")}>
            {PageCategory.options.map((value) => (
              <option key={value} value={value}>
                {PAGE_CATEGORY_LABELS[value]}
              </option>
            ))}
          </select>
        </Field>
        <Field id="page-website" label="Website" error={errors.website}>
          <input
            id="page-website"
            value={values.website}
            onChange={set("website")}
            inputMode="url"
            autoComplete="url"
            placeholder="https://"
            aria-invalid={errors.website ? true : undefined}
            className={inputClasses(!!errors.website)}
          />
        </Field>
      </div>

      <Field id="page-tagline" label="Tagline" hint={counter(values.tagline.length, TAGLINE_MAX)} error={errors.tagline}>
        <input
          id="page-tagline"
          value={values.tagline}
          onChange={set("tagline")}
          maxLength={TAGLINE_MAX}
          placeholder="One line on what you do"
          aria-invalid={errors.tagline ? true : undefined}
          className={inputClasses(!!errors.tagline)}
        />
      </Field>

      <Field id="page-about" label="About" hint={counter(values.about.length, ABOUT_MAX)} error={errors.about}>
        <textarea
          id="page-about"
          value={values.about}
          onChange={set("about")}
          maxLength={ABOUT_MAX}
          rows={6}
          placeholder="Who you are, what you work on and how members can get involved"
          aria-invalid={errors.about ? true : undefined}
          className={inputClasses(!!errors.about, "h-auto resize-y py-2.5")}
        />
      </Field>

      <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
        <Field id="page-countryCode" label="Country" error={errors.countryCode}>
          <CountrySelect id="page-countryCode" groups={countries} value={values.countryCode} onChange={set("countryCode")} invalid={!!errors.countryCode} placeholder="Where it is based" />
        </Field>
        <Field id="page-city" label="City" error={errors.city}>
          <input id="page-city" value={values.city} onChange={set("city")} maxLength={80} autoComplete="address-level2" className={inputClasses(!!errors.city)} />
        </Field>
      </div>

      <Divider />
      <PagePictureField kind="logo" name={values.name} url={logo.url} onChange={(picture) => setLogo({ ...picture, changed: true })} />
      {errors.logoFileId && <p className="-mt-3 text-xs text-error">{errors.logoFileId}</p>}
      <PagePictureField kind="cover" name={values.name} url={cover.url} onChange={(picture) => setCover({ ...picture, changed: true })} />
      {errors.coverFileId && <p className="-mt-3 text-xs text-error">{errors.coverFileId}</p>}

      <Divider />
      <section aria-labelledby="page-details-heading" className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <h2 id="page-details-heading" className="text-h3 text-ink">
            Contact and details
          </h2>
          <p className="text-sm text-secondary">All optional. Members see these in the page’s About tab, with buttons to get in touch.</p>
        </div>

        <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
          <Field id="page-contactEmail" label="Contact email" error={errors.contactEmail}>
            <input
              id="page-contactEmail"
              type="email"
              value={values.contactEmail}
              onChange={set("contactEmail")}
              maxLength={254}
              autoComplete="email"
              inputMode="email"
              placeholder="hello@example.org"
              aria-invalid={errors.contactEmail ? true : undefined}
              className={inputClasses(!!errors.contactEmail)}
            />
          </Field>
          <Field id="page-contactPhone" label="Phone" error={errors.contactPhone}>
            <input
              id="page-contactPhone"
              type="tel"
              value={values.contactPhone}
              onChange={set("contactPhone")}
              maxLength={24}
              autoComplete="tel"
              placeholder="+233 30 123 4567"
              aria-invalid={errors.contactPhone ? true : undefined}
              className={inputClasses(!!errors.contactPhone)}
            />
          </Field>
          <Field id="page-whatsapp" label="WhatsApp" error={errors.whatsapp}>
            <input
              id="page-whatsapp"
              type="tel"
              value={values.whatsapp}
              onChange={set("whatsapp")}
              maxLength={24}
              placeholder="+233 24 123 4567"
              aria-invalid={errors.whatsapp ? true : undefined}
              aria-describedby="page-whatsapp-hint"
              className={inputClasses(!!errors.whatsapp)}
            />
            <p id="page-whatsapp-hint" className="text-xs text-secondary">
              With the country code, so people can message you in one tap.
            </p>
          </Field>
          <Field id="page-hours" label="Opening hours" hint={counter(values.hours.length, HOURS_MAX)} error={errors.hours}>
            <input
              id="page-hours"
              value={values.hours}
              onChange={set("hours")}
              maxLength={HOURS_MAX}
              placeholder="e.g. Mon–Fri 9:00–17:00"
              aria-invalid={errors.hours ? true : undefined}
              className={inputClasses(!!errors.hours)}
            />
          </Field>
        </div>

        <Field id="page-address" label="Address" hint={counter(values.address.length, ADDRESS_MAX)} error={errors.address}>
          <textarea
            id="page-address"
            value={values.address}
            onChange={set("address")}
            maxLength={ADDRESS_MAX}
            rows={2}
            autoComplete="street-address"
            placeholder="Street, area and city, so visitors can find you"
            aria-invalid={errors.address ? true : undefined}
            className={inputClasses(!!errors.address, "h-auto resize-y py-2.5")}
          />
        </Field>

        <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
          <Field id="page-foundedYear" label="Year founded" error={errors.foundedYear}>
            <input
              id="page-foundedYear"
              value={values.foundedYear}
              onChange={set("foundedYear")}
              inputMode="numeric"
              maxLength={4}
              placeholder="e.g. 2015"
              aria-invalid={errors.foundedYear ? true : undefined}
              className={inputClasses(!!errors.foundedYear)}
            />
          </Field>
          <Field id="page-teamSize" label="Team size" error={errors.teamSize}>
            <select id="page-teamSize" value={values.teamSize} onChange={set("teamSize")} className={inputClasses(!!errors.teamSize, "cursor-pointer")}>
              <option value="">Not shown</option>
              {PageTeamSize.options.map((size) => (
                <option key={size} value={size}>
                  {t(TEAM_SIZE_LABELS[size])}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field
          id="page-sectorIds"
          label="Sectors"
          hint={<span className="text-xs text-secondary">{t("{count} of {max}", { count: sectorIds.length, max: MAX_SECTORS })}</span>}
          error={errors.sectorIds}
        >
          <SectorPicker
            id="page-sectorIds"
            options={sectors}
            value={sectorIds}
            max={MAX_SECTORS}
            invalid={!!errors.sectorIds}
            onChange={(ids) => {
              setSectorIds(ids);
              clearError("sectorIds");
            }}
          />
        </Field>

        <Field
          id="page-specialties"
          label="Specialties"
          hint={<span className="text-xs text-secondary">{t("{count} of {max}", { count: specialties.length, max: MAX_SPECIALTIES })}</span>}
          error={errors.specialties}
        >
          <SpecialtiesInput
            id="page-specialties"
            value={specialties}
            max={MAX_SPECIALTIES}
            maxLength={SPECIALTY_MAX}
            invalid={!!errors.specialties}
            onChange={(next) => {
              setSpecialties(next);
              clearError("specialties");
            }}
          />
        </Field>

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-sm font-medium text-ink">Social links</legend>
          <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
            {SOCIAL_NETWORKS.map(({ key, label }) => {
              const field = `socialLinks.${key}`;
              return (
                <Field key={key} id={`page-${field}`} label={label} error={errors[field]}>
                  <input
                    id={`page-${field}`}
                    value={social[key]}
                    onChange={(event) => {
                      const value = event.target.value;
                      setSocial((current) => ({ ...current, [key]: value }));
                      clearError(field);
                    }}
                    inputMode="url"
                    maxLength={300}
                    placeholder="https://"
                    aria-invalid={errors[field] ? true : undefined}
                    className={inputClasses(!!errors[field])}
                  />
                </Field>
              );
            })}
          </div>
        </fieldset>
      </section>

      <div className="flex items-center justify-end gap-2.5 border-t border-line pt-5">
        <Button variant="secondary" onClick={() => router.push(page ? pageHref(page.slug) : "/pages")} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : page ? (page.status === "rejected" ? "Save and resubmit" : "Save changes") : "Create page"}
        </Button>
      </div>
    </form>
  );
}
