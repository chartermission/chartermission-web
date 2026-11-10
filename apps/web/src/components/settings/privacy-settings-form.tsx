"use client";

import { useMemo, useState, type FormEvent } from "react";
import {
  DEFAULT_FIELD_VISIBILITY,
  ProfileField,
  type FieldVisibility,
  type OwnProfile,
  type PrivacySettingsInput,
  type ProfileVisibility,
} from "@chartermission/contracts";
import { api, isApiError } from "@/lib/api/client";
import { SettingsSelect, VisibilitySelect } from "./controls";
import { ProfilePreview } from "./profile-preview";
import { SaveBar } from "./save-bar";
import { SettingsCard, ToggleRow } from "./settings-card";
import type { Translate } from "@/i18n/translate";
import { useT } from "@/i18n/client";

type State = {
  profileVisibility: ProfileVisibility;
  fieldVisibility: Record<ProfileField, FieldVisibility>;
  discoverable: boolean;
  findableByEmail: boolean;
  connectionRequestsFrom: "members" | "nobody";
};

const fieldLabels: Record<ProfileField, string> = {
  email: "Email address",
  location: "Location",
  bio: "About",
  organisation: "Organisation",
  website: "Website",
  links: "Links",
  skills: "Skills",
  sectors: "Sectors",
  interests: "Interests",
  languages: "Languages",
  experience: "Experience",
  introVideo: "Intro video",
  resume: "Résumé",
  network: "Connections and followers",
};

const profileVisibilityOptions = [
  { value: "members", label: "Members only" },
  { value: "public", label: "Public" },
] as const;

const connectionOptions = [
  { value: "members", label: "Any member" },
  { value: "nobody", label: "No one" },
] as const;

function stateFrom(profile: OwnProfile): State {
  return {
    profileVisibility: profile.profileVisibility,
    fieldVisibility: { ...DEFAULT_FIELD_VISIBILITY, ...profile.fieldVisibility },
    discoverable: profile.discoverable,
    findableByEmail: profile.findableByEmail,
    connectionRequestsFrom: profile.connectionRequestsFrom,
  };
}

const names = (items: { name: string }[]) => items.map((item) => item.name).join(", ");

function fieldValue(t: Translate, field: ProfileField, profile: OwnProfile, email: string, countryName: string | null): string {
  switch (field) {
    case "email":
      return email;
    case "location":
      return [profile.city, countryName].filter(Boolean).join(", ");
    case "bio":
      return profile.bio ? (profile.bio.length > 80 ? `${profile.bio.slice(0, 80)}…` : profile.bio) : "";
    case "organisation":
      return profile.organisation ?? "";
    case "website":
      return profile.website ?? "";
    case "links":
      return profile.links.length ? t("{count} links", { count: profile.links.length }) : "";
    case "experience":
      return profile.experience.length ? t("{count} roles", { count: profile.experience.length }) : "";
    case "network":
      return "The lists of your connections, your followers and who you follow";
    case "introVideo":
      return profile.introVideo ? "Your intro video" : "";
    case "resume":
      return profile.resume ? profile.resume.name : "";
    default:
      return names(profile[field]);
  }
}

/** Privacy & visibility (CM-PRF-02, 03, 05): per-field visibility, discoverability and "Preview as". */
export function PrivacySettingsForm({
  profile,
  email,
  countryName,
}: {
  profile: OwnProfile;
  email: string;
  countryName: string | null;
}) {
  const t = useT();
  const [saved, setSaved] = useState<State>(() => stateFrom(profile));
  const [state, setState] = useState<State>(saved);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewKey, setPreviewKey] = useState(0);
  const dirty = useMemo(() => JSON.stringify(state) !== JSON.stringify(saved), [state, saved]);

  function update(patch: Partial<State>) {
    setState((current) => ({ ...current, ...patch }));
    setJustSaved(false);
    setError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dirty || saving) return;
    setSaving(true);
    setError(null);
    try {
      const body: PrivacySettingsInput = { ...state, fieldVisibility: { ...state.fieldVisibility } };
      const updated = await api<OwnProfile>("/me/privacy", { method: "PUT", body });
      const next = stateFrom(updated);
      setSaved(next);
      setState(next);
      setJustSaved(true);
      setPreviewKey((key) => key + 1);
    } catch (e) {
      setError(isApiError(e) ? e.message : "Your settings weren’t saved. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <form onSubmit={handleSubmit} className="flex w-full min-w-0 flex-col gap-5" aria-label="Privacy settings">
        <SettingsCard id="profile-visibility" title="Profile visibility">
          <li className="flex items-center gap-4 py-3.5 max-sm:flex-col max-sm:items-start">
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <label htmlFor="profile-visibility-select" className="text-sm font-medium text-ink">
                Who can see your profile
              </label>
              <span id="profile-visibility-hint" className="text-xs text-secondary">
                Public profiles can be seen by visitors who aren’t signed in. Field settings below still apply.
              </span>
            </div>
            <SettingsSelect
              id="profile-visibility-select"
              aria-describedby="profile-visibility-hint"
              options={profileVisibilityOptions}
              value={state.profileVisibility}
              onChange={(event) => update({ profileVisibility: event.target.value as ProfileVisibility })}
            />
          </li>
        </SettingsCard>

        <SettingsCard
          id="profile-fields"
          title="Profile fields"
          description="Your name, photo and headline are always visible to members."
          aside={<span className="text-label text-secondary max-sm:hidden">Who can see it</span>}
        >
          {ProfileField.options.map((field) => {
            const value = fieldValue(t, field, profile, email, countryName);
            return (
              <li key={field} className="flex items-center gap-4 py-3 max-sm:flex-col max-sm:items-start max-sm:gap-2">
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <label htmlFor={`visibility-${field}`} className="text-sm font-medium text-ink">
                    {fieldLabels[field]}
                  </label>
                  <p id={`visibility-${field}-value`} className="truncate text-xs text-secondary">
                    {value || "Not added yet"}
                  </p>
                </div>
                <VisibilitySelect
                  id={`visibility-${field}`}
                  name={`visibility.${field}`}
                  aria-describedby={`visibility-${field}-value`}
                  value={state.fieldVisibility[field]}
                  onChange={(visibility) => update({ fieldVisibility: { ...state.fieldVisibility, [field]: visibility } })}
                />
              </li>
            );
          })}
        </SettingsCard>

        <SettingsCard id="discoverability" title="Discoverability">
          <ToggleRow
            label="Show me in the member directory"
            description="Members can find you by country, sector and skills."
            checked={state.discoverable}
            onChange={(discoverable) => update({ discoverable })}
          />
          <ToggleRow
            label="Let people find me by email address"
            description="Only people who already know your exact email address."
            checked={state.findableByEmail}
            onChange={(findableByEmail) => update({ findableByEmail })}
          />
          <li className="flex items-center gap-4 py-3.5 max-sm:flex-col max-sm:items-start">
            <label htmlFor="connection-requests" className="min-w-0 flex-1 text-sm font-medium text-ink">
              Who can send me connection requests
            </label>
            <SettingsSelect
              id="connection-requests"
              name="connectionRequestsFrom"
              options={connectionOptions}
              value={state.connectionRequestsFrom}
              onChange={(event) => update({ connectionRequestsFrom: event.target.value as State["connectionRequestsFrom"] })}
            />
          </li>
        </SettingsCard>

        <SaveBar
          dirty={dirty}
          saving={saving}
          justSaved={justSaved}
          error={error}
          onDiscard={() => {
            setState(saved);
            setError(null);
          }}
        />
      </form>

      <ProfilePreview
        refreshKey={previewKey}
        unsaved={dirty}
        filled={ProfileField.options.filter((field) => fieldValue(t, field, profile, email, countryName) !== "")}
      />
    </div>
  );
}
