"use client";

import { useRouter } from "next/navigation";
import { useId, useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  UpdateProfileInput,
  type ExperienceItem,
  type OwnProfile,
  type ProfileLink,
  type Taxonomies,
} from "@chartermission/contracts";
import { Button, Icon, Panel, cn, type AvatarTone } from "@chartermission/ui";
import { api, isApiError } from "@/lib/api/client";
import type { CountryGroup } from "@/lib/taxonomies";
import { AvatarUploader } from "@/components/account/avatar-uploader";
import { CountrySelect } from "@/components/account/country-select";
import { RestrictedPrompt } from "@/components/account/verify-prompt";
import { Field, describedBy, inputClasses } from "@/components/auth/fields";
import { ChipPicker } from "@/components/onboarding/chip-picker";
import { SaveBar } from "./save-bar";
import { SettingsCard } from "./settings-card";

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
};

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
  return out;
}

function Section({ id, title, description, children }: { id: string; title: string; description?: string; children: ReactNode }) {
  return (
    <SettingsCard id={id} title={title} description={description} list={false}>
      {children}
    </SettingsCard>
  );
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
    if (!parsed.success) {
      const found: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
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
            : `Add ${completeness.missing.map((key) => missingLabels[key] ?? key).join(", ")} to help members find you.`}
        </p>
      </Panel>

      {formError?.restricted && <RestrictedPrompt message={formError.text} />}

      <Section id="basics" title="Photo and basics">
        <AvatarUploader
          name={draft.name || profile.name}
          tone={tone}
          avatarUrl={profile.avatarUrl}
          onChange={() => router.refresh()}
        />
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

      <Section id="links" title="Links" description="Professional and social links, up to 6.">
        {draft.links.length === 0 && <p className="text-sm text-secondary">No links yet.</p>}
        {draft.links.map((link, index) => (
          <fieldset key={index} className="grid grid-cols-[160px_1fr_auto] items-start gap-2 max-sm:grid-cols-[1fr_auto]">
            <legend className="sr-only">Link {index + 1}</legend>
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
                placeholder="https://"
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
              aria-label={`Remove link ${index + 1}`}
              onClick={() => update({ links: draft.links.filter((_, i) => i !== index) })}
            >
              <Icon name="x" size={16} />
            </Button>
          </fieldset>
        ))}
        {draft.links.length < 6 && (
          <Button
            variant="secondary"
            size="small"
            className="self-start"
            onClick={() => update({ links: [...draft.links, { label: "", url: "" }] })}
          >
            <Icon name="plus" size={14} />
            Add link
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
          options={taxonomies.skills.map((t) => ({ id: t.id, label: t.name }))}
          selected={draft.skillIds}
          onChange={(skillIds) => update({ skillIds })}
          max={30}
        />
        <ChipPicker
          label="Sectors"
          options={taxonomies.sectors.map((t) => ({ id: t.id, label: t.name }))}
          selected={draft.sectorIds}
          onChange={(sectorIds) => update({ sectorIds })}
          max={10}
        />
        <ChipPicker
          label="Interests"
          options={taxonomies.interests.map((t) => ({ id: t.id, label: t.name }))}
          selected={draft.interestIds}
          onChange={(interestIds) => update({ interestIds })}
          max={20}
        />
        <ChipPicker
          label="Languages"
          options={taxonomies.languages.map((t) => ({ id: t.id, label: t.name }))}
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
                  ? `${item.title || "Role"}${item.organisation ? ` · ${item.organisation}` : ""}`
                  : `Role ${index + 1}`}
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
