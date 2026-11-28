"use client";

import { useEffect, useRef, useState } from "react";
import { PAGE_CATEGORY_LABELS, PageCategory, UPLOAD_LIMITS, type Country, type PageRef } from "@chartermission/contracts";
import { Avatar, Button, Icon } from "@chartermission/ui";
import { Field, FormModal, SelectBox } from "@/components/ambassadors/modal";
import { TextField, inputClasses } from "@/components/form-field";
import { ApiError, api, errorMessage } from "@/lib/api/client";
import { uploadFile } from "@/lib/upload";
import { useT } from "@/i18n/client";

/** Words in an organisation's name that suggest its kind of page. */
function guessCategory(name: string): PageCategory {
  const n = name.toLowerCase();
  if (/\b(university|college|school|academy|institute of technology|polytechnic)\b/.test(n)) return "education";
  if (/\b(ministry|government|agency|authority|commission|council|embassy|state of)\b/.test(n)) return "government";
  if (/\b(foundation|trust|ngo|charity|non-profit|nonprofit|initiative for)\b/.test(n)) return "nonprofit";
  if (/\b(ltd|limited|plc|inc|llc|corp|company|bank|group|technologies|tech|ventures|capital|holdings)\b/.test(n)) return "company";
  return "organisation";
}

/**
 * "Create organisation" in the import: a live page with basic details that the team runs
 * (POST /admin/opportunities/organisations). Owned by the staff member creating it; the logo is
 * optional. On save the parent selects it for the row.
 */
export function CreateOrganisationDialog({
  name,
  countries,
  onCreated,
  onClose,
}: {
  /** Prefilled from the row's organisation. */
  name: string;
  countries: Country[];
  onCreated: (page: PageRef) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [logo, setLogo] = useState<{ id: string; preview: string } | null>(null);
  const [upload, setUpload] = useState<{ kind: "idle" } | { kind: "uploading"; progress: number } | { kind: "error"; text: string }>({ kind: "idle" });
  const fileRef = useRef<HTMLInputElement>(null);
  const [category] = useState(() => guessCategory(name));

  useEffect(() => () => {
    if (logo) URL.revokeObjectURL(logo.preview);
  }, [logo]);

  async function onLogo(file: File) {
    setUpload({ kind: "uploading", progress: 0 });
    try {
      const view = await uploadFile(file, "page_logo", (progress) => setUpload({ kind: "uploading", progress }));
      setLogo({ id: view.id, preview: URL.createObjectURL(file) });
      setUpload({ kind: "idle" });
    } catch (e) {
      setUpload({ kind: "error", text: errorMessage(e) });
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function submit(data: FormData) {
    const text = (key: string) => String(data.get(key) ?? "").trim();
    const website = text("website");
    const body = {
      name: text("name"),
      category: text("category"),
      website: website ? (/^https?:\/\//i.test(website) ? website : `https://${website}`) : null,
      countryCode: text("countryCode") || null,
      city: text("city") || null,
      tagline: text("tagline") || null,
      about: text("about") || null,
      logoFileId: logo?.id ?? null,
    };
    setBusy(true);
    setError(null);
    setFields({});
    try {
      onCreated(await api<PageRef>("/admin/opportunities/organisations", { method: "POST", body }));
    } catch (e) {
      if (e instanceof ApiError && e.fields) setFields(e.fields);
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  const uploading = upload.kind === "uploading";
  return (
    <FormModal
      title={t("Create organisation")}
      description="A page for the organisation, live straight away and run by the Charter Mission team. You can add more details later under Pages."
      submitLabel="Create and use"
      busy={busy || uploading}
      error={error}
      wide
      onSubmit={(d) => void submit(d)}
      onClose={onClose}
    >
      <div className="grid max-h-[62dvh] grid-cols-1 gap-4 overflow-y-auto pe-1 sm:grid-cols-2">
        <TextField label="Name" name="name" required minLength={2} maxLength={80} defaultValue={name.slice(0, 80)} error={fields.name} dir="auto" />
        <Field label="Kind of page" error={fields.category}>
          {(id, describedBy) => (
            <SelectBox
              id={id}
              name="category"
              defaultValue={category}
              describedBy={describedBy}
              invalid={!!fields.category}
              options={PageCategory.options.map((value) => ({ value, label: t(PAGE_CATEGORY_LABELS[value]) }))}
            />
          )}
        </Field>
        <TextField label="Website" name="website" inputMode="url" placeholder="https://" error={fields.website} hint="Optional" dir="ltr" />
        <Field label="Country" hint="Optional" error={fields.countryCode}>
          {(id, describedBy) => (
            <SelectBox id={id} name="countryCode" defaultValue="" describedBy={describedBy} invalid={!!fields.countryCode} options={[{ value: "", label: t("No country") }, ...countries.map((c) => ({ value: c.code, label: c.name }))]} />
          )}
        </Field>
        <TextField label="City" name="city" maxLength={80} error={fields.city} hint="Optional" dir="auto" />
        <TextField label="Tagline" name="tagline" maxLength={120} error={fields.tagline} hint="One line under the page name." dir="auto" />
        <div className="sm:col-span-2">
          <Field label="About" hint="Optional" error={fields.about}>
            {(id, describedBy) => <textarea id={id} name="about" rows={3} maxLength={2000} aria-describedby={describedBy} className={inputClasses(!!fields.about, "h-auto resize-y py-2")} dir="auto" />}
          </Field>
        </div>
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <span className="text-label text-ink">Logo</span>
          <div className="flex flex-wrap items-center gap-3">
            {logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logo.preview} alt="" className="size-14 rounded-lg border border-line object-cover" />
            ) : (
              <Avatar name={name || "?"} size={56} tone="tint" className="rounded-lg" />
            )}
            <div className="flex flex-col items-start gap-1">
              <div className="flex gap-2">
                <input
                  ref={fileRef}
                  type="file"
                  accept={UPLOAD_LIMITS.page_logo.mimes.join(",")}
                  className="sr-only"
                  tabIndex={-1}
                  aria-label={t("Upload a logo")}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void onLogo(file);
                  }}
                />
                <Button variant="secondary" size="small" disabled={busy || uploading} onClick={() => fileRef.current?.click()}>
                  <Icon name="image" size={14} />
                  {uploading ? t("Uploading… {number}%", { number: Math.round(upload.progress * 100) }) : logo ? "Change logo" : "Upload a logo"}
                </Button>
                {logo && (
                  <Button variant="ghost" size="small" disabled={busy || uploading} onClick={() => setLogo(null)}>
                    Remove
                  </Button>
                )}
              </div>
              <p className="text-xs text-secondary">Optional. A square JPEG, PNG or WebP image.</p>
              {(upload.kind === "error" || fields.logoFileId) && (
                <p role="alert" className="flex items-center gap-1.5 text-xs text-error">
                  <Icon name="alert" size={14} />
                  {upload.kind === "error" ? upload.text : fields.logoFileId}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </FormModal>
  );
}
