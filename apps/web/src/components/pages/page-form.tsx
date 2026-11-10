"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { PAGE_CATEGORY_LABELS, PageCategory, PageInput, type PageCreationPolicy, type PageDetail } from "@chartermission/contracts";
import { Button, Divider } from "@chartermission/ui";
import { CountrySelect } from "@/components/account/country-select";
import { Field, FormAlert, inputClasses } from "@/components/auth/fields";
import { ErrorNotice } from "@/components/social/errors";
import { pageHref } from "@/components/social/links";
import { toast } from "@/components/social/toast";
import { api, isApiError } from "@/lib/api/client";
import type { CountryGroup } from "@/lib/taxonomies";
import { PagePictureField } from "./picture-field";

type Values = { name: string; tagline: string; about: string; category: string; website: string; countryCode: string; city: string };
type Picture = { fileId: string | null; url: string | null; changed: boolean };

const TAGLINE_MAX = 120;
const ABOUT_MAX = 2000;

function initialValues(page?: PageDetail): Values {
  return {
    name: page?.name ?? "",
    tagline: page?.tagline ?? "",
    about: page?.about ?? "",
    category: page?.category ?? "organisation",
    website: page?.website ?? "",
    countryCode: page?.country?.code ?? "",
    city: page?.city ?? "",
  };
}

/**
 * Create a page, or edit one. New pages follow the platform's policy: live straight away, or sent
 * to the Charter Mission team for review first (the form says which before it is submitted).
 */
export function PageForm({ page, countries, policy }: { page?: PageDetail; countries: CountryGroup[]; policy?: PageCreationPolicy }) {
  const router = useRouter();
  const [values, setValues] = useState<Values>(() => initialValues(page));
  const [logo, setLogo] = useState<Picture>({ fileId: null, url: page?.logoUrl ?? null, changed: false });
  const [cover, setCover] = useState<Picture>({ fileId: null, url: page?.coverUrl ?? null, changed: false });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const set = (key: keyof Values) => (event: { target: { value: string } }) => {
    setValues((current) => ({ ...current, [key]: event.target.value }));
    if (errors[key])
      setErrors((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
  };

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setServerError(null);
    const website = values.website.trim();
    const payload = {
      name: values.name,
      tagline: values.tagline.trim() || null,
      about: values.about.trim() || null,
      category: values.category,
      // People type "example.org": accept it and store a full address.
      website: website ? (/^https?:\/\//i.test(website) ? website : `https://${website}`) : null,
      countryCode: values.countryCode || null,
      city: values.city.trim() || null,
      ...(logo.changed ? { logoFileId: logo.fileId } : {}),
      ...(cover.changed ? { coverFileId: cover.fileId } : {}),
    };
    const parsed = PageInput.safeParse(payload);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? "");
        if (key && !next[key]) next[key] = issue.message;
      }
      setErrors(next);
      document.getElementById(`page-${Object.keys(next)[0]}`)?.focus();
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
        document.getElementById(`page-${Object.keys(error.fields)[0]}`)?.focus();
      } else setServerError(error);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      {!page && policy === "review" && (
        <FormAlert tone="info" icon="clock">
          New pages are checked by the Charter Mission team before they go live, usually within two working days. You can keep editing while you wait.
        </FormAlert>
      )}
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

      <Field
        id="page-tagline"
        label="Tagline"
        hint={<span className="text-xs text-secondary">{values.tagline.length} / {TAGLINE_MAX}</span>}
        error={errors.tagline}
      >
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

      <Field id="page-about" label="About" hint={<span className="text-xs text-secondary">{values.about.length} / {ABOUT_MAX}</span>} error={errors.about}>
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

      <div className="flex items-center justify-end gap-2.5 border-t border-line pt-5">
        <Button variant="secondary" onClick={() => router.push(page ? pageHref(page.slug) : "/pages")} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : page ? (page.status === "rejected" ? "Save and resubmit" : "Save changes") : policy === "review" ? "Create and send for review" : "Create page"}
        </Button>
      </div>
    </form>
  );
}
