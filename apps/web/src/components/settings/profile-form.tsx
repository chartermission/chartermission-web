"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  CertificationItem,
  PROFILE_CERTIFICATIONS_MAX,
  PROFILE_LINKS_MAX,
  SOCIAL_NETWORKS,
  UpdateProfileInput,
  socialNetworkOf,
  type ExperienceItem,
  type OwnProfile,
  type ProfileLink,
  type Taxonomies,
} from "@chartermission/contracts";
import { Button, Icon, Panel, cn, type AvatarTone } from "@chartermission/ui";
import { api, isApiError } from "@/lib/api/client";
import type { CountryGroup } from "@/lib/taxonomies";
import { AvatarUploader } from "@/components/account/avatar-uploader";
import { CoverUploader } from "@/components/account/cover-uploader";
import { CountrySelect } from "@/components/account/country-select";
import { RestrictedPrompt } from "@/components/account/verify-prompt";
import { Checkbox, Field, describedBy, inputClasses } from "@/components/auth/fields";
import { ChipPicker } from "@/components/onboarding/chip-picker";
import { CertificationTile, VerifiedChip } from "@/components/people/certification-parts";
import { monthLabel } from "@/components/social/format";
import { NoTranslate } from "@/i18n/auto";
import { Switch } from "./controls";
import { SaveBar } from "./save-bar";
import { SettingsCard } from "./settings-card";
import { T, useIntlTag, useLocale, useT } from "@/i18n/client";

type Draft = {
  name: string;
  headline: string;
  organisation: string;
  website: string;
  countryCode: string;
  city: string;
  bio: string;
  links: ProfileLink[];
  skillIds: string[];
  sectorIds: string[];
  interestIds: string[];
  languageIds: string[];
  experience: ExperienceItem[];
  certifications: CertificationDraft[];
  /** Charter Mission exam certificates hidden from the profile. */
  hiddenExamIds: string[];
};

/** A license or certification being edited: text fields as typed, plus the "doesn't expire" box. */
type CertificationDraft = {
  /** Stable React key, also for rows not saved yet (not sent). */
  key: string;
  id?: string;
  name: string;
  issuer: string;
  issueDate: string;
  expiryDate: string;
  /** Checked: no expiry date is sent (the typed one is kept in case it's unticked again). */
  noExpiry: boolean;
  credentialId: string;
  credentialUrl: string;
};

let certificationKeys = 0;
const newCertificationKey = () => `new-certification-${++certificationKeys}`;

function certificationDraft(item: CertificationItem): CertificationDraft {
  return {
    key: item.id ?? newCertificationKey(),
    id: item.id,
    name: item.name,
    issuer: item.issuer,
    issueDate: item.issueDate ?? "",
    expiryDate: item.expiryDate ?? "",
    // A saved one with no expiry date doesn't expire.
    noExpiry: !item.expiryDate,
    credentialId: item.credentialId ?? "",
    credentialUrl: item.credentialUrl ?? "",
  };
}

/** As sent in PATCH /me/profile (and compared for unsaved changes). */
function certificationItem(item: CertificationDraft): CertificationItem {
  return {
    ...(item.id ? { id: item.id } : {}),
    name: item.name.trim(),
    issuer: item.issuer.trim(),
    issueDate: item.issueDate || null,
    expiryDate: item.noExpiry ? null : item.expiryDate || null,
    credentialId: item.credentialId.trim() || null,
    credentialUrl: item.credentialUrl.trim() || null,
  };
}

/** Field errors for each certification (CertificationItem), keyed like the API's: certifications.0.name. */
function certificationErrors(items: CertificationDraft[], only?: number): Record<string, string> {
  const found: Record<string, string> = {};
  items.forEach((item, index) => {
    if (only !== undefined && index !== only) return;
    const parsed = CertificationItem.safeParse(certificationItem(item));
    if (parsed.success) return;
    for (const issue of parsed.error.issues) found[`certifications.${index}.${issue.path.join(".")}`] ??= issue.message;
  });
  return found;
}

const missingLabels: Record<string, string> = {
  avatar: "a photo",
  headline: "a headline",
  country: "your country",
  city: "your city",
  bio: "an about section",
  organisation: "your organisation",
  skills: "skills",
  sectors: "sectors",
  interests: "interests",
  languages: "languages",
  experience: "experience",
  introVideo: "an intro video",
  cover: "a cover photo",
};

function draftFrom(profile: OwnProfile): Draft {
  return {
    name: profile.name,
    headline: profile.headline ?? "",
    organisation: profile.organisation ?? "",
    website: profile.website ?? "",
    countryCode: profile.countryCode ?? "",
    city: profile.city ?? "",
    bio: profile.bio ?? "",
    links: profile.links,
    skillIds: profile.skills.map((s) => s.id),
    sectorIds: profile.sectors.map((s) => s.id),
    interestIds: profile.interests.map((s) => s.id),
    languageIds: profile.languages.map((s) => s.id),
    experience: profile.experience.map((item) => ({
      ...item,
      location: item.location ?? null,
      endDate: item.endDate ?? null,
      description: item.description ?? null,
    })),
    // Read defensively: older API builds don't send these yet.
    certifications: (profile.certifications ?? []).map(certificationDraft),
    hiddenExamIds: (profile.examCertifications ?? []).filter((item) => !item.shown).map((item) => item.id),
  };
}

const nullable = (value: string) => value.trim() || null;

/** Only the fields that changed, shaped as UpdateProfileInput. */
function changes(draft: Draft, saved: Draft): UpdateProfileInput {
  const out: UpdateProfileInput = {};
  if (draft.name.trim() !== saved.name) out.name = draft.name.trim();
  for (const key of ["headline", "organisation", "website", "city", "bio"] as const) {
    if (draft[key].trim() !== saved[key].trim()) out[key] = nullable(draft[key]);
  }
  if (draft.countryCode !== saved.countryCode) out.countryCode = draft.countryCode || null;
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  if (!same(draft.links, saved.links)) out.links = draft.links.map((l) => ({ label: l.label.trim(), url: l.url.trim() }));
  for (const key of ["skillIds", "sectorIds", "interestIds", "languageIds"] as const) {
    if (!same([...draft[key]].sort(), [...saved[key]].sort())) out[key] = draft[key];
  }
  if (!same(draft.experience, saved.experience)) {
    out.experience = draft.experience.map((item) => ({
      ...item,
      title: item.title.trim(),
      organisation: item.organisation.trim(),
      location: item.location?.trim() || null,
      endDate: item.endDate || null,
      description: item.description?.trim() || null,
    }));
  }
  const certifications = draft.certifications.map(certificationItem);
  if (!same(certifications, saved.certifications.map(certificationItem))) out.certifications = certifications;
  if (!same([...draft.hiddenExamIds].sort(), [...saved.hiddenExamIds].sort())) out.hiddenExamCertificateIds = draft.hiddenExamIds;
  return out;
}

function Section({ id, title, description, children }: { id: string; title: string; description?: string; children: ReactNode }) {
  return (
    <SettingsCard id={id} title={title} description={description} list={false}>
      {children}
    </SettingsCard>
  );
}

/**
 * Picker options: the list members can choose from, plus any option this member already has that
 * an admin has since hidden from pickers (so they still see it and can remove it).
 */
function pickerOptions(list: { id: string; name: string }[], held: { id: string; name: string }[]) {
  const ids = new Set(list.map((item) => item.id));
  return [...list, ...held.filter((item) => !ids.has(item.id))].map((item) => ({ id: item.id, label: item.name }));
}

/** Profile editor (CM-PRF-01, 04, 07): GET/PATCH /me/profile with a completeness meter. */
export function ProfileForm({
  profile,
  taxonomies,
  countryGroups,
  tone,
}: {
  profile: OwnProfile;
  taxonomies: Pick<Taxonomies, "skills" | "sectors" | "interests" | "languages">;
  countryGroups: CountryGroup[];
  tone: AvatarTone;
}) {
  const t = useT();
  const intl = useIntlTag();
  const { locale } = useLocale();
  const id = useId();
  const router = useRouter();
  const [saved, setSaved] = useState<Draft>(() => draftFrom(profile));
  const [draft, setDraft] = useState<Draft>(saved);
  const [completeness, setCompleteness] = useState(profile.completeness);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<{ text: string; restricted?: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const pending = useMemo(() => changes(draft, saved), [draft, saved]);
  const dirty = Object.keys(pending).length > 0;

  // Links such as /settings/profile#cover arrive before this streamed-in form exists, so the
  // browser can't jump to the section by itself: do it once the form (and #intro beside it) is in.
  useEffect(() => {
    const target = window.location.hash.slice(1);
    if (target) document.getElementById(decodeURIComponent(target))?.scrollIntoView({ block: "start" });
  }, []);

  function update(patch: Partial<Draft>) {
    setDraft((prev) => ({ ...prev, ...patch }));
    setJustSaved(false);
    setFormError(null);
    const keys = Object.keys(patch);
    setErrors((prev) =>
      Object.fromEntries(Object.entries(prev).filter(([key]) => !keys.some((k) => key === k || key.startsWith(`${k}.`)))),
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dirty || saving) return;
    const parsed = UpdateProfileInput.safeParse(pending);
    // Each certification is checked on its own too, so its messages sit under the right field.
    const certificationIssues = pending.certifications ? certificationErrors(draft.certifications) : {};
    if (!parsed.success || Object.keys(certificationIssues).length > 0) {
      const found: Record<string, string> = { ...certificationIssues };
      for (const issue of parsed.success ? [] : parsed.error.issues) {
        const key = issue.path.join(".");
        found[key] ??=
          /url|website/i.test(key) && issue.code === "invalid_format"
            ? "Enter a full web address starting with https://"
            : issue.message;
      }
      setErrors(found);
      setFormError({ text: "Check the highlighted fields." });
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const updated = await api<OwnProfile>("/me/profile", { method: "PATCH", body: parsed.data });
      const next = draftFrom(updated);
      setSaved(next);
      setDraft(next);
      setCompleteness(updated.completeness);
      setErrors({});
      setJustSaved(true);
      router.refresh();
    } catch (e) {
      if (isApiError(e) && e.fields) {
        setErrors(e.fields);
        setFormError({ text: e.message });
      } else if (isApiError(e, "ACCOUNT_SUSPENDED") || isApiError(e, "ACCOUNT_DEACTIVATED")) {
        setFormError({ text: e.message, restricted: true });
      } else {
        setFormError({ text: isApiError(e) ? e.message : "Your profile wasn’t saved. Please try again." });
      }
    } finally {
      setSaving(false);
    }
  }

  const err = (key: string) => errors[key];
  const text = (
    key: "name" | "headline" | "organisation" | "website" | "city",
    label: string,
    props: { max: number; placeholder?: string; type?: string; autoComplete?: string; hint?: boolean },
  ) => (
    <Field
      id={`${id}-${key}`}
      label={label}
      error={err(key)}
      hint={
        props.hint ? (
          <span className="text-xs text-secondary">
            {draft[key].length}/{props.max}
          </span>
        ) : undefined
      }
    >
      <input
        id={`${id}-${key}`}
        name={key}
        type={props.type ?? "text"}
        autoComplete={props.autoComplete}
        placeholder={props.placeholder}
        value={draft[key]}
        maxLength={props.max + 20}
        onChange={(e) => update({ [key]: e.target.value } as Partial<Draft>)}
        aria-invalid={err(key) ? true : undefined}
        aria-describedby={describedBy(err(key) && `${id}-${key}-error`)}
        className={inputClasses(!!err(key))}
      />
    </Field>
  );

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-5" aria-label="Edit profile">
      <Panel aria-labelledby={`${id}-completeness`} className="flex flex-col gap-3 p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 id={`${id}-completeness`} className="text-h3 text-ink">
            Profile strength
          </h2>
          <span className="text-h3 text-primary">{completeness.percent}%</span>
        </div>
        <div
          role="progressbar"
          aria-labelledby={`${id}-completeness`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={completeness.percent}
          className="h-2 overflow-hidden rounded-full bg-muted"
        >
          <span
            className="block h-full rounded-full bg-success transition-[width]"
            style={{ width: `${completeness.percent}%` }}
          />
        </div>
        <p className="text-sm text-secondary">
          {completeness.missing.length === 0
            ? "Your profile is complete. Members can see who you are and what you work on."
            : t("Add {fields} to help members find you.", { fields: new Intl.ListFormat(locale, { style: "long", type: "conjunction" }).format(completeness.missing.map((key) => t(missingLabels[key] ?? key))) })}
        </p>
      </Panel>

      {formError?.restricted && <RestrictedPrompt message={formError.text} />}

      <Section id="basics" title="Photo and basics">
        {/* Anchors for the profile completion card's links (/settings/profile#photo, #cover). */}
        <div id="photo" className="scroll-mt-24">
          <AvatarUploader
            name={draft.name || profile.name}
            tone={tone}
            avatarUrl={profile.avatarUrl}
            onChange={() => router.refresh()}
          />
        </div>
        <div id="cover" className="scroll-mt-24">
          <CoverUploader coverUrl={profile.coverUrl} onChange={() => router.refresh()} />
        </div>
        {text("name", "Display name", { max: 80, autoComplete: "name" })}
        {text("headline", "Headline", { max: 120, placeholder: "e.g. Renewable energy engineer · Lagos", hint: true })}
        <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
          {text("organisation", "Organisation", { max: 120, autoComplete: "organization" })}
          {text("website", "Website", { max: 300, type: "url", placeholder: "https://", autoComplete: "url" })}
        </div>
        <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
          <Field id={`${id}-country`} label="Country" error={err("countryCode")}>
            <CountrySelect
              id={`${id}-country`}
              groups={countryGroups}
              value={draft.countryCode}
              invalid={!!err("countryCode")}
              onChange={(e) => update({ countryCode: e.target.value })}
            />
          </Field>
          {text("city", "City", { max: 80, autoComplete: "address-level2" })}
        </div>
      </Section>

      <Section id="about" title="About" description="Up to 2,000 characters.">
        <Field
          id={`${id}-bio`}
          label="Biography"
          error={err("bio")}
          hint={
            <span className={cn("text-xs", draft.bio.length > 2000 ? "text-error" : "text-secondary")}>
              {draft.bio.length}/2000
            </span>
          }
        >
          <textarea
            id={`${id}-bio`}
            rows={6}
            value={draft.bio}
            onChange={(e) => update({ bio: e.target.value })}
            aria-invalid={err("bio") ? true : undefined}
            aria-describedby={describedBy(err("bio") && `${id}-bio-error`)}
            className={cn(inputClasses(!!err("bio")), "h-auto py-2.5")}
          />
        </Field>
      </Section>

      <Section id="links" title="Social and professional links" description={t("Your LinkedIn, X, Instagram and other pages, shown on your profile. Up to {PROFILELINKSMAX}.", { PROFILELINKSMAX: PROFILE_LINKS_MAX })}>
        {draft.links.length === 0 && <p className="text-sm text-secondary">No links yet. Pick a network to add yours.</p>}
        {draft.links.length < PROFILE_LINKS_MAX && (
          <div className="flex flex-wrap gap-2" role="group" aria-label="Add a link">
            {SOCIAL_NETWORKS.filter((network) => !draft.links.some((link) => socialNetworkOf(link.url)?.key === network.key || link.label.trim().toLowerCase() === network.label.toLowerCase())).map((network) => (
              <button
                key={network.key}
                type="button"
                onClick={() => update({ links: [...draft.links, { label: network.label, url: "" }] })}
                className="flex items-center gap-1 rounded-full border border-line-strong px-3 py-1 text-sm text-body hover:bg-muted"
              >
                <Icon name="plus" size={14} />
                {network.label}
              </button>
            ))}
          </div>
        )}
        {draft.links.map((link, index) => (
          <fieldset key={index} className="grid grid-cols-[160px_1fr_auto] items-start gap-2 max-sm:grid-cols-[1fr_auto]">
            <legend className="sr-only"><T vars={{ count: index + 1 }}>{"Link {count}"}</T></legend>
            <div className="flex flex-col gap-1 max-sm:col-span-2">
              <label htmlFor={`${id}-link-${index}-label`} className="sr-only">
                Label
              </label>
              <input
                id={`${id}-link-${index}-label`}
                placeholder="Label, e.g. LinkedIn"
                value={link.label}
                maxLength={40}
                onChange={(e) =>
                  update({ links: draft.links.map((l, i) => (i === index ? { ...l, label: e.target.value } : l)) })
                }
                aria-invalid={err(`links.${index}.label`) ? true : undefined}
                className={inputClasses(!!err(`links.${index}.label`))}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor={`${id}-link-${index}-url`} className="sr-only">
                URL
              </label>
              <input
                id={`${id}-link-${index}-url`}
                type="url"
                placeholder={SOCIAL_NETWORKS.find((network) => network.label.toLowerCase() === link.label.trim().toLowerCase())?.example ?? "https://"}
                dir="ltr"
                value={link.url}
                onChange={(e) => update({ links: draft.links.map((l, i) => (i === index ? { ...l, url: e.target.value } : l)) })}
                aria-invalid={err(`links.${index}.url`) ? true : undefined}
                aria-describedby={describedBy(err(`links.${index}.url`) && `${id}-link-${index}-error`)}
                className={inputClasses(!!err(`links.${index}.url`))}
              />
              {(err(`links.${index}.url`) || err(`links.${index}.label`)) && (
                <p id={`${id}-link-${index}-error`} className="text-xs text-error">
                  {err(`links.${index}.url`) ?? err(`links.${index}.label`)}
                </p>
              )}
            </div>
            <Button
              variant="ghost"
              className="h-11"
              aria-label={t("Remove link {count}", { count: index + 1 })}
              onClick={() => update({ links: draft.links.filter((_, i) => i !== index) })}
            >
              <Icon name="x" size={16} />
            </Button>
          </fieldset>
        ))}
        {draft.links.length < PROFILE_LINKS_MAX && (
          <Button
            variant="secondary"
            size="small"
            className="self-start"
            onClick={() => update({ links: [...draft.links, { label: "", url: "" }] })}
          >
            <Icon name="plus" size={14} />
            Add another link
          </Button>
        )}
      </Section>

      <Section
        id="skills"
        title="Skills, sectors and interests"
        description="Used for the directory filters and member suggestions."
      >
        <ChipPicker
          label="Skills"
          options={pickerOptions(taxonomies.skills, profile.skills)}
          selected={draft.skillIds}
          onChange={(skillIds) => update({ skillIds })}
          max={30}
        />
        <ChipPicker
          id="sectors"
          label="Sectors"
          options={pickerOptions(taxonomies.sectors, profile.sectors)}
          selected={draft.sectorIds}
          onChange={(sectorIds) => update({ sectorIds })}
          max={10}
        />
        <ChipPicker
          id="interests"
          label="Interests"
          options={pickerOptions(taxonomies.interests, profile.interests)}
          selected={draft.interestIds}
          onChange={(interestIds) => update({ interestIds })}
          max={20}
        />
        <ChipPicker
          id="languages"
          label="Languages"
          options={pickerOptions(taxonomies.languages, profile.languages)}
          selected={draft.languageIds}
          onChange={(languageIds) => update({ languageIds })}
          max={10}
        />
      </Section>

      <Section id="experience" title="Experience" description="Roles you’ve held, most recent first.">
        {draft.experience.length === 0 && <p className="text-sm text-secondary">No experience added yet.</p>}
        {draft.experience.map((item, index) => {
          const set = (patch: Partial<ExperienceItem>) =>
            update({ experience: draft.experience.map((e, i) => (i === index ? { ...e, ...patch } : e)) });
          const key = (field: string) => `experience.${index}.${field}`;
          return (
            <fieldset key={item.id ?? `new-${index}`} className="flex flex-col gap-3 rounded-lg border border-line p-4">
              <legend className="px-1 text-sm font-medium text-ink">
                {item.title || item.organisation
                  ? `${item.title || t("Role")}${item.organisation ? ` · ${item.organisation}` : ""}`
                  : t("Role {count}", { count: index + 1 })}
              </legend>
              <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
                <Field id={`${id}-${key("title")}`} label="Title" error={err(key("title"))}>
                  <input
                    id={`${id}-${key("title")}`}
                    value={item.title}
                    maxLength={120}
                    onChange={(e) => set({ title: e.target.value })}
                    className={inputClasses(!!err(key("title")))}
                  />
                </Field>
                <Field id={`${id}-${key("organisation")}`} label="Organisation" error={err(key("organisation"))}>
                  <input
                    id={`${id}-${key("organisation")}`}
                    value={item.organisation}
                    maxLength={120}
                    onChange={(e) => set({ organisation: e.target.value })}
                    className={inputClasses(!!err(key("organisation")))}
                  />
                </Field>
                <Field id={`${id}-${key("startDate")}`} label="Started" error={err(key("startDate"))}>
                  <input
                    id={`${id}-${key("startDate")}`}
                    type="month"
                    value={item.startDate}
                    onChange={(e) => set({ startDate: e.target.value })}
                    className={inputClasses(!!err(key("startDate")))}
                  />
                </Field>
                <Field
                  id={`${id}-${key("endDate")}`}
                  label="Ended"
                  error={err(key("endDate"))}
                  hint={<span className="text-xs text-secondary">Leave empty if current</span>}
                >
                  <input
                    id={`${id}-${key("endDate")}`}
                    type="month"
                    value={item.endDate ?? ""}
                    onChange={(e) => set({ endDate: e.target.value || null })}
                    className={inputClasses(!!err(key("endDate")))}
                  />
                </Field>
              </div>
              <Field id={`${id}-${key("location")}`} label="Location (optional)" error={err(key("location"))}>
                <input
                  id={`${id}-${key("location")}`}
                  value={item.location ?? ""}
                  maxLength={120}
                  onChange={(e) => set({ location: e.target.value })}
                  className={inputClasses(!!err(key("location")))}
                />
              </Field>
              <Field id={`${id}-${key("description")}`} label="Description (optional)" error={err(key("description"))}>
                <textarea
                  id={`${id}-${key("description")}`}
                  rows={3}
                  value={item.description ?? ""}
                  maxLength={1000}
                  onChange={(e) => set({ description: e.target.value })}
                  className={cn(inputClasses(!!err(key("description"))), "h-auto py-2.5")}
                />
              </Field>
              <Button
                variant="ghost"
                size="small"
                className="self-end text-error!"
                onClick={() => update({ experience: draft.experience.filter((_, i) => i !== index) })}
              >
                Remove role
              </Button>
            </fieldset>
          );
        })}
        {draft.experience.length < 20 && (
          <Button
            variant="secondary"
            size="small"
            className="self-start"
            onClick={() =>
              update({
                experience: [
                  ...draft.experience,
                  { title: "", organisation: "", startDate: "", endDate: null, location: null, description: null },
                ],
              })
            }
          >
            <Icon name="plus" size={14} />
            Add role
          </Button>
        )}
      </Section>

      <Section
        id="certifications"
        title="Licenses & certifications"
        description="Professional licenses, certifications and courses you’ve completed. Fields marked * are required."
      >
        {draft.certifications.length === 0 && <p className="text-sm text-secondary">No licenses or certifications added yet.</p>}
        {draft.certifications.map((item, index) => {
          const list = draft.certifications;
          const set = (patch: Partial<CertificationDraft>) =>
            update({ certifications: list.map((c, i) => (i === index ? { ...c, ...patch } : c)) });
          const move = (to: number) => {
            const next = [...list];
            const [moved] = next.splice(index, 1);
            next.splice(to, 0, moved!);
            update({ certifications: next });
          };
          const key = (field: string) => `certifications.${index}.${field}`;
          const fieldId = (field: string) => `${id}-${key(field)}`;
          const errorProps = (field: string) => ({
            "aria-invalid": err(key(field)) ? true : undefined,
            "aria-describedby": describedBy(err(key(field)) && `${fieldId(field)}-error`),
          });
          const title = item.name.trim()
            ? `${item.name.trim()}${item.issuer.trim() ? ` · ${item.issuer.trim()}` : ""}`
            : t("License or certification {number}", { number: index + 1 });
          return (
            <fieldset
              key={item.key}
              className="flex min-w-0 flex-col gap-3 rounded-lg border border-line p-4"
              onBlur={(e) => {
                // Leaving a certification checks it, so mistakes show before saving.
                if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
                const prefix = `certifications.${index}.`;
                const found = certificationErrors(draft.certifications, index);
                setErrors((prev) => ({ ...Object.fromEntries(Object.entries(prev).filter(([k]) => !k.startsWith(prefix))), ...found }));
              }}
            >
              <legend className="max-w-full px-1 text-sm font-medium text-ink">
                {item.name.trim() ? (
                  <NoTranslate>
                    <span dir="auto" className="bidi-auto break-words">
                      {title}
                    </span>
                  </NoTranslate>
                ) : (
                  title
                )}
              </legend>
              <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
                <Field
                  id={fieldId("name")}
                  label={
                    <>
                      Name<span aria-hidden="true" className="ms-0.5 text-error">*</span>
                    </>
                  }
                  error={err(key("name"))}
                >
                  <input
                    id={fieldId("name")}
                    value={item.name}
                    maxLength={150}
                    aria-required
                    placeholder="e.g. Project Management Professional (PMP)"
                    onChange={(e) => set({ name: e.target.value })}
                    {...errorProps("name")}
                    className={inputClasses(!!err(key("name")))}
                  />
                </Field>
                <Field
                  id={fieldId("issuer")}
                  label={
                    <>
                      Issuing organisation<span aria-hidden="true" className="ms-0.5 text-error">*</span>
                    </>
                  }
                  error={err(key("issuer"))}
                >
                  <input
                    id={fieldId("issuer")}
                    value={item.issuer}
                    maxLength={120}
                    aria-required
                    autoComplete="organization"
                    placeholder="e.g. Project Management Institute"
                    onChange={(e) => set({ issuer: e.target.value })}
                    {...errorProps("issuer")}
                    className={inputClasses(!!err(key("issuer")))}
                  />
                </Field>
                <Field id={fieldId("issueDate")} label="Issue date" error={err(key("issueDate"))}>
                  <input
                    id={fieldId("issueDate")}
                    type="month"
                    value={item.issueDate}
                    onChange={(e) => set({ issueDate: e.target.value })}
                    {...errorProps("issueDate")}
                    className={inputClasses(!!err(key("issueDate")))}
                  />
                </Field>
                <div className="flex flex-col gap-2">
                  <Field id={fieldId("expiryDate")} label="Expiry date" error={err(key("expiryDate"))}>
                    <input
                      id={fieldId("expiryDate")}
                      type="month"
                      value={item.noExpiry ? "" : item.expiryDate}
                      disabled={item.noExpiry}
                      onChange={(e) => set({ expiryDate: e.target.value })}
                      {...errorProps("expiryDate")}
                      className={inputClasses(!!err(key("expiryDate")), "disabled:cursor-not-allowed disabled:bg-muted disabled:text-disabled")}
                    />
                  </Field>
                  <Checkbox name={`${key("noExpiry")}`} checked={item.noExpiry} onChange={(e) => set({ noExpiry: e.target.checked })}>
                    <span className="text-body">This credential doesn’t expire</span>
                  </Checkbox>
                </div>
                <Field id={fieldId("credentialId")} label="Credential ID" error={err(key("credentialId"))}>
                  <input
                    id={fieldId("credentialId")}
                    value={item.credentialId}
                    maxLength={100}
                    dir="auto"
                    onChange={(e) => set({ credentialId: e.target.value })}
                    {...errorProps("credentialId")}
                    className={inputClasses(!!err(key("credentialId")))}
                  />
                </Field>
                <Field id={fieldId("credentialUrl")} label="Credential URL" error={err(key("credentialUrl"))}>
                  <input
                    id={fieldId("credentialUrl")}
                    type="url"
                    inputMode="url"
                    dir="ltr"
                    value={item.credentialUrl}
                    maxLength={500}
                    placeholder="https://"
                    onChange={(e) => set({ credentialUrl: e.target.value })}
                    {...errorProps("credentialUrl")}
                    className={inputClasses(!!err(key("credentialUrl")))}
                  />
                </Field>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="small" disabled={index === 0} onClick={() => move(index - 1)}>
                    <Icon name="chevron-down" size={14} className="rotate-180" />
                    Move up
                  </Button>
                  <Button variant="ghost" size="small" disabled={index === list.length - 1} onClick={() => move(index + 1)}>
                    <Icon name="chevron-down" size={14} />
                    Move down
                  </Button>
                </div>
                <Button
                  variant="ghost"
                  size="small"
                  className="text-error!"
                  onClick={() => update({ certifications: list.filter((_, i) => i !== index) })}
                >
                  Remove certification
                </Button>
              </div>
            </fieldset>
          );
        })}
        {draft.certifications.length < PROFILE_CERTIFICATIONS_MAX ? (
          <Button
            variant="secondary"
            size="small"
            className="self-start"
            onClick={() =>
              update({
                certifications: [
                  ...draft.certifications,
                  { key: newCertificationKey(), name: "", issuer: "", issueDate: "", expiryDate: "", noExpiry: false, credentialId: "", credentialUrl: "" },
                ],
              })
            }
          >
            <Icon name="plus" size={14} />
            Add licenses and certifications
          </Button>
        ) : (
          <div className="flex flex-col items-start gap-1.5">
            <Button variant="secondary" size="small" disabled aria-describedby={`${id}-certifications-max`}>
              <Icon name="plus" size={14} />
              Add licenses and certifications
            </Button>
            <p id={`${id}-certifications-max`} className="text-xs text-secondary">
              {t("You can add up to {max} licenses and certifications.", { max: PROFILE_CERTIFICATIONS_MAX })}
            </p>
          </div>
        )}

        {(profile.examCertifications ?? []).length > 0 && (
          <div className="flex flex-col gap-3 border-t border-line pt-4">
            <div className="flex flex-col gap-0.5">
              <h3 className="text-md font-semibold text-ink">From Charter Mission</h3>
              <p className="text-xs text-secondary">Certificates you earned through Charter Mission exams. Choose which ones show on your profile.</p>
            </div>
            <ul className="flex flex-col divide-y divide-line">
              {(profile.examCertifications ?? []).map((cert) => {
                const shown = !draft.hiddenExamIds.includes(cert.id);
                const switchId = `${id}-exam-${cert.id}`;
                return (
                  <li key={cert.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0 max-sm:flex-wrap">
                    <CertificationTile imageUrl={cert.imageUrl} />
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <NoTranslate>
                          <span id={`${switchId}-name`} dir="auto" className="bidi-auto min-w-0 break-words text-sm font-semibold text-ink">
                            {cert.name}
                          </span>
                        </NoTranslate>
                        <VerifiedChip />
                      </span>
                      <NoTranslate>
                        <span dir="auto" className="bidi-auto text-sm text-body">
                          {cert.issuer}
                        </span>
                      </NoTranslate>
                      {cert.issueDate && <span className="text-xs text-secondary">{t("Issued {date}", { date: monthLabel(intl, cert.issueDate) })}</span>}
                    </div>
                    <div className="flex shrink-0 items-center gap-2 max-sm:ms-14">
                      <label htmlFor={switchId} className="cursor-pointer text-sm text-body">
                        Show on my profile
                      </label>
                      <Switch
                        id={switchId}
                        checked={shown}
                        describedBy={`${switchId}-name`}
                        onChange={(next) =>
                          update({
                            hiddenExamIds: next ? draft.hiddenExamIds.filter((hidden) => hidden !== cert.id) : [...draft.hiddenExamIds, cert.id],
                          })
                        }
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </Section>

      <SaveBar
        dirty={dirty}
        saving={saving}
        justSaved={justSaved}
        error={formError && !formError.restricted ? formError.text : null}
        onDiscard={() => {
          setDraft(saved);
          setErrors({});
          setFormError(null);
        }}
      />
    </form>
  );
}
