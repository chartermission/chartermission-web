"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import {
  ONBOARDING_STEPS,
  OnboardingUpdateInput,
  type OnboardingState,
  type OwnProfile,
  type Taxonomies,
} from "@chartermission/contracts";
import { Button, Icon, Panel, type AvatarTone } from "@chartermission/ui";
import { api, isApiError } from "@/lib/api/client";
import type { CountryGroup } from "@/lib/taxonomies";
import { AvatarUploader } from "@/components/account/avatar-uploader";
import { CountrySelect } from "@/components/account/country-select";
import { RestrictedPrompt } from "@/components/account/verify-prompt";
import { Field, FormAlert, describedBy, inputClasses, retryMessage } from "@/components/auth/fields";
import { ChipPicker } from "./chip-picker";
import { CommunityStep } from "./community-step";
import { OnboardingProgress } from "./progress";

type StepKey = (typeof ONBOARDING_STEPS)[number];

type Draft = {
  headline: string;
  countryCode: string;
  city: string;
  organisation: string;
  interestIds: string[];
  followedHashtags: string[];
  skillIds: string[];
  sectorIds: string[];
  languageIds: string[];
  followedChapterIds: string[];
  followedMemberIds: string[];
};

type FieldErrors = Partial<Record<"headline" | "countryCode" | "city" | "organisation" | "hashtag", string>>;

const LAST = ONBOARDING_STEPS.length - 1;
const HASHTAG = /^[A-Za-z0-9_]{2,50}$/;

const stepCopy: Record<StepKey, { title: string; description: string }> = {
  about: {
    title: "Tell members about yourself",
    description: "A headline and location help people know who you are and where you work.",
  },
  topics: {
    title: "What do you care about?",
    description: "Pick interests and hashtags to shape your feed. You can change them any time.",
  },
  skills: {
    title: "Your skills and sectors",
    description: "These help members with shared work find you, and power your suggestions.",
  },
  community: { title: "Find your people", description: "Follow members and chapters to fill your feed from day one." },
};

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((value) => b.includes(value));
const lower = (values: string[]) => values.map((value) => value.toLowerCase());

function draftFrom(state: OnboardingState, profile: Pick<OwnProfile, "organisation" | "languages">): Draft {
  return {
    headline: state.data.headline ?? "",
    countryCode: state.data.countryCode ?? "",
    city: state.data.city ?? "",
    organisation: profile.organisation ?? "",
    interestIds: state.data.interestIds,
    followedHashtags: state.data.followedHashtags,
    skillIds: state.data.skillIds,
    sectorIds: state.data.sectorIds,
    languageIds: profile.languages.map((language) => language.id),
    followedChapterIds: state.data.followedChapterIds,
    followedMemberIds: state.data.followedMemberIds,
  };
}

/** Onboarding wizard (CM-AUTH-07): four steps, each saved server-side, skippable and resumable. */
export function OnboardingWizard({
  initial,
  profile,
  taxonomies,
  countryGroups,
  viewer,
}: {
  initial: OnboardingState;
  profile: Pick<OwnProfile, "organisation" | "languages" | "avatarUrl">;
  taxonomies: Pick<Taxonomies, "interests" | "skills" | "sectors" | "languages" | "chapters">;
  countryGroups: CountryGroup[];
  viewer: { name: string; tone: AvatarTone; emailVerified: boolean };
}) {
  const id = useId();
  const router = useRouter();
  const heading = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);
  const [index, setIndex] = useState(Math.min(initial.step, LAST));
  const [draft, setDraft] = useState<Draft>(() => draftFrom(initial, profile));
  // What the server last confirmed, to diff follows and profile fields.
  const [saved, setSaved] = useState<Draft>(() => draftFrom(initial, profile));
  const [suggestions] = useState(initial.suggestions);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<{ text: string; restricted?: boolean } | null>(null);
  const [busy, setBusy] = useState<"save" | "skip" | null>(null);
  const [customTag, setCustomTag] = useState("");
  const [extraTags, setExtraTags] = useState<string[]>([]);

  const step = ONBOARDING_STEPS[index];

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    heading.current?.focus();
    window.scrollTo({ top: 0 });
  }, [index]);

  const update = (patch: Partial<Draft>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
    setFormError(null);
  };

  function validate(): FieldErrors {
    const next: FieldErrors = {};
    if (step === "about") {
      if (draft.headline.trim().length > 120) next.headline = "Use 120 characters or fewer";
      if (draft.city.trim().length > 80) next.city = "Use 80 characters or fewer";
      if (draft.organisation.trim().length > 120) next.organisation = "Use 120 characters or fewer";
    }
    return next;
  }

  async function unfollowRemoved(type: "hashtag" | "member" | "chapter", before: string[], after: string[]) {
    const keep = type === "hashtag" ? lower(after) : after;
    const removed = before.filter((value) => !keep.includes(type === "hashtag" ? value.toLowerCase() : value));
    await Promise.all(
      removed.map((targetId) =>
        api("/follows", { method: "DELETE", body: { targetType: type, targetId } }).catch(() => undefined),
      ),
    );
  }

  async function sideEffects() {
    if (step === "about" && draft.organisation.trim() !== saved.organisation.trim()) {
      await api("/me/profile", { method: "PATCH", body: { organisation: draft.organisation.trim() || null } });
    }
    if (step === "topics") await unfollowRemoved("hashtag", saved.followedHashtags, draft.followedHashtags);
    if (step === "skills" && !sameSet(draft.languageIds, saved.languageIds)) {
      await api("/me/profile", { method: "PATCH", body: { languageIds: draft.languageIds } });
    }
    if (step === "community") {
      await unfollowRemoved("member", saved.followedMemberIds, draft.followedMemberIds);
      await unfollowRemoved("chapter", saved.followedChapterIds, draft.followedChapterIds);
    }
  }

  function payload(action: "save" | "skip"): OnboardingUpdateInput {
    if (action === "skip") return { step, action, data: {} };
    const data: OnboardingUpdateInput["data"] =
      step === "about"
        ? { headline: draft.headline.trim() || null, countryCode: draft.countryCode || null, city: draft.city.trim() || null }
        : step === "topics"
          ? { interestIds: draft.interestIds, followedHashtags: draft.followedHashtags }
          : step === "skills"
            ? { skillIds: draft.skillIds, sectorIds: draft.sectorIds }
            : { followedChapterIds: draft.followedChapterIds, followedMemberIds: draft.followedMemberIds };
    return { step, action, data };
  }

  async function submit(action: "save" | "skip", event?: FormEvent) {
    event?.preventDefault();
    if (busy) return;
    if (action === "save") {
      const found = validate();
      setErrors(found);
      if (Object.keys(found).length > 0) return;
    }
    setBusy(action);
    setFormError(null);
    try {
      if (action === "save") await sideEffects();
      const state = await api<OnboardingState>("/me/onboarding", { method: "PUT", body: payload(action) });
      const follows = {
        followedHashtags: state.data.followedHashtags,
        followedMemberIds: state.data.followedMemberIds,
        followedChapterIds: state.data.followedChapterIds,
      };
      setSaved((prev) => ({
        ...prev,
        ...follows,
        ...(action === "save" ? { organisation: draft.organisation, languageIds: draft.languageIds } : {}),
      }));
      if (action === "save") setDraft((prev) => ({ ...prev, ...follows }));
      if (index >= LAST) {
        router.replace("/feed");
        router.refresh();
        return;
      }
      setBusy(null);
      setIndex(index + 1);
    } catch (error) {
      setBusy(null);
      if (isApiError(error, "VALIDATION_FAILED") && error.fields) {
        setErrors(error.fields as FieldErrors);
        setFormError({ text: error.message });
      } else if (isApiError(error, "ACCOUNT_SUSPENDED") || isApiError(error, "ACCOUNT_DEACTIVATED")) {
        setFormError({ text: error.message, restricted: true });
      } else if (isApiError(error, "RATE_LIMITED")) {
        setFormError({ text: retryMessage(error.retryAfter) });
      } else {
        setFormError({ text: isApiError(error) ? error.message : "Something went wrong. Please try again." });
      }
    }
  }

  function addCustomTag() {
    const tag = customTag.trim().replace(/^#/, "");
    if (!HASHTAG.test(tag)) {
      setErrors({ hashtag: "Use 2–50 letters, numbers or underscores, without spaces" });
      return;
    }
    if (!lower(draft.followedHashtags).includes(tag.toLowerCase())) {
      if (draft.followedHashtags.length >= 30) {
        setErrors({ hashtag: "You can follow up to 30 hashtags here" });
        return;
      }
      update({ followedHashtags: [...draft.followedHashtags, tag] });
    }
    if (!suggestions.hashtags.some((s) => s.tag.toLowerCase() === tag.toLowerCase())) {
      setExtraTags((prev) => (prev.some((t) => t.toLowerCase() === tag.toLowerCase()) ? prev : [...prev, tag]));
    }
    setCustomTag("");
    setErrors({});
  }

  const firstName = viewer.name.split(/\s+/)[0] ?? viewer.name;
  const copy = stepCopy[step];
  const tagOptions = [
    ...suggestions.hashtags.map((s) => ({
      id: s.tag,
      label: `#${s.tag}`,
      badge: s.trending ? (
        <span className="inline-flex items-center gap-0.5 text-xs text-accent" title="Trending now">
          <Icon name="flame" size={12} />
          <span className="sr-only">trending</span>
        </span>
      ) : undefined,
    })),
    ...[...draft.followedHashtags, ...extraTags]
      .filter((tag, i, all) => all.findIndex((t) => t.toLowerCase() === tag.toLowerCase()) === i)
      .filter((tag) => !suggestions.hashtags.some((s) => s.tag.toLowerCase() === tag.toLowerCase()))
      .map((tag) => ({ id: tag, label: `#${tag}` })),
  ];
  // Selected ids must match option ids case-insensitively (the API may return a different display case).
  const selectedTags = tagOptions.filter((o) => lower(draft.followedHashtags).includes(o.id.toLowerCase())).map((o) => o.id);

  return (
    <div className="mx-auto flex w-full max-w-[760px] flex-col gap-6 px-6 pt-8 pb-16 max-sm:px-4 max-sm:pt-5">
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-accent">Welcome to Charter Mission, {firstName}</p>
        <OnboardingProgress current={index} />
      </div>

      <Panel aria-labelledby={`${id}-title`} className="flex flex-col">
        <form noValidate onSubmit={(e) => void submit("save", e)} className="flex flex-col">
          <div className="flex flex-col gap-1.5 border-b border-line p-6 max-sm:p-5">
            <h1 id={`${id}-title`} ref={heading} tabIndex={-1} className="text-h2 text-ink focus-visible:outline-none">
              {copy.title}
            </h1>
            <p className="text-md text-secondary">{copy.description}</p>
          </div>

          <div className="flex flex-col gap-6 p-6 max-sm:p-5">
            {formError &&
              (formError.restricted ? (
                <RestrictedPrompt message={formError.text} />
              ) : (
                <FormAlert tone="error">{formError.text}</FormAlert>
              ))}

            {step === "about" && (
              <>
                <AvatarUploader
                  name={viewer.name}
                  tone={viewer.tone}
                  avatarUrl={profile.avatarUrl}
                />
                <Field
                  id={`${id}-headline`}
                  label="Headline"
                  error={errors.headline}
                  hint={<span className="text-xs text-secondary">{draft.headline.length}/120</span>}
                >
                  <input
                    id={`${id}-headline`}
                    name="headline"
                    value={draft.headline}
                    maxLength={140}
                    placeholder="e.g. Agritech founder building cold-chain logistics"
                    onChange={(e) => update({ headline: e.target.value })}
                    aria-invalid={errors.headline ? true : undefined}
                    aria-describedby={describedBy(errors.headline && `${id}-headline-error`)}
                    className={inputClasses(!!errors.headline)}
                  />
                </Field>
                <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
                  <Field id={`${id}-country`} label="Country" error={errors.countryCode}>
                    <CountrySelect
                      id={`${id}-country`}
                      name="countryCode"
                      groups={countryGroups}
                      value={draft.countryCode}
                      invalid={!!errors.countryCode}
                      onChange={(e) => update({ countryCode: e.target.value })}
                      aria-describedby={describedBy(errors.countryCode && `${id}-country-error`)}
                    />
                  </Field>
                  <Field id={`${id}-city`} label="City" error={errors.city}>
                    <input
                      id={`${id}-city`}
                      name="city"
                      autoComplete="address-level2"
                      value={draft.city}
                      onChange={(e) => update({ city: e.target.value })}
                      aria-invalid={errors.city ? true : undefined}
                      aria-describedby={describedBy(errors.city && `${id}-city-error`)}
                      className={inputClasses(!!errors.city)}
                    />
                  </Field>
                </div>
                <Field id={`${id}-organisation`} label="Organisation" error={errors.organisation}>
                  <input
                    id={`${id}-organisation`}
                    name="organisation"
                    autoComplete="organization"
                    value={draft.organisation}
                    placeholder="Where you work or study"
                    onChange={(e) => update({ organisation: e.target.value })}
                    aria-invalid={errors.organisation ? true : undefined}
                    aria-describedby={describedBy(errors.organisation && `${id}-organisation-error`)}
                    className={inputClasses(!!errors.organisation)}
                  />
                </Field>
                <p className="flex items-center gap-2 text-xs text-secondary">
                  <Icon name="eye" size={14} />
                  You choose who sees each field later in Settings → Privacy.
                </p>
              </>
            )}

            {step === "topics" && (
              <>
                <ChipPicker
                  label="Interests"
                  options={taxonomies.interests.map((item) => ({ id: item.id, label: item.name }))}
                  selected={draft.interestIds}
                  onChange={(interestIds) => update({ interestIds })}
                  max={20}
                />
                <ChipPicker
                  label="Hashtags to follow"
                  description="Popular this week. The flame marks topics trending now."
                  tone="hashtag"
                  options={tagOptions}
                  selected={selectedTags}
                  onChange={(followedHashtags) => update({ followedHashtags })}
                  max={30}
                  emptyText="No hashtags yet — add your own below."
                />
                <Field id={`${id}-tag`} label="Follow another hashtag" error={errors.hashtag}>
                  <div className="flex gap-2">
                    <input
                      id={`${id}-tag`}
                      value={customTag}
                      placeholder="#CleanEnergy"
                      autoComplete="off"
                      onChange={(e) => {
                        setCustomTag(e.target.value);
                        setErrors({});
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addCustomTag();
                        }
                      }}
                      aria-invalid={errors.hashtag ? true : undefined}
                      aria-describedby={describedBy(errors.hashtag && `${id}-tag-error`)}
                      className={inputClasses(!!errors.hashtag, "max-w-[280px]")}
                    />
                    <Button variant="secondary" onClick={addCustomTag}>
                      Add
                    </Button>
                  </div>
                </Field>
              </>
            )}

            {step === "skills" && (
              <>
                <ChipPicker
                  label="Skills"
                  options={taxonomies.skills.map((item) => ({ id: item.id, label: item.name }))}
                  selected={draft.skillIds}
                  onChange={(skillIds) => update({ skillIds })}
                  max={30}
                />
                <ChipPicker
                  label="Sectors"
                  options={taxonomies.sectors.map((item) => ({ id: item.id, label: item.name }))}
                  selected={draft.sectorIds}
                  onChange={(sectorIds) => update({ sectorIds })}
                  max={10}
                />
                <ChipPicker
                  label="Languages you speak"
                  options={taxonomies.languages.map((item) => ({ id: item.id, label: item.name }))}
                  selected={draft.languageIds}
                  onChange={(languageIds) => update({ languageIds })}
                  max={10}
                />
              </>
            )}

            {step === "community" && (
              <CommunityStep
                members={suggestions.members}
                chapters={taxonomies.chapters}
                countryCode={draft.countryCode || null}
                followedMemberIds={draft.followedMemberIds}
                followedChapterIds={draft.followedChapterIds}
                onChange={(patch) => update(patch)}
              />
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3 border-t border-line p-6 max-sm:p-5">
            {index > 0 && (
              <Button variant="ghost" onClick={() => setIndex(index - 1)} disabled={!!busy}>
                <Icon name="chevron-left" size={16} />
                Back
              </Button>
            )}
            <span className="flex-1" />
            <Button
              variant="secondary"
              onClick={() => void submit("skip")}
              disabled={!!busy}
              aria-busy={busy === "skip" || undefined}
            >
              {busy === "skip" ? "Skipping…" : index === LAST ? "Skip and finish" : "Skip"}
            </Button>
            <Button type="submit" disabled={!!busy} aria-busy={busy === "save" || undefined}>
              {busy === "save" ? "Saving…" : index === LAST ? "Finish" : "Save & continue"}
            </Button>
          </div>
        </form>
      </Panel>
      <p className="text-center text-xs text-secondary" aria-live="polite">
        Your progress is saved after each step — you can come back to it from any device.
      </p>
    </div>
  );
}
