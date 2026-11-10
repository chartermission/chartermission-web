"use client";

import { useEffect, useState } from "react";
import type { MemberProfile, PreviewAs, ProfileField } from "@chartermission/contracts";
import { Avatar, Chip, Icon, Panel, SegmentedControl } from "@chartermission/ui";
import { api, isApiError } from "@/lib/api/client";

const audiences: { value: PreviewAs; label: string; description: string }[] = [
  { value: "public", label: "Public", description: "A visitor who isn’t signed in" },
  { value: "member", label: "Member", description: "A signed-in member you aren’t connected to" },
  { value: "connection", label: "Connection", description: "A member you’re connected with" },
];

const shownFields: { key: ProfileField; label: string }[] = [
  { key: "location", label: "Location" },
  { key: "organisation", label: "Organisation" },
  { key: "email", label: "Email" },
  { key: "website", label: "Website" },
  { key: "bio", label: "About" },
  { key: "links", label: "Links" },
  { key: "skills", label: "Skills" },
  { key: "sectors", label: "Sectors" },
  { key: "interests", label: "Interests" },
  { key: "languages", label: "Languages" },
  { key: "experience", label: "Experience" },
];

function valueOf(profile: MemberProfile, key: ProfileField): string | string[] | null {
  switch (key) {
    case "network":
      return null;
    case "location":
      return profile.country || profile.city ? [profile.city, profile.country?.name].filter(Boolean).join(", ") : null;
    case "links":
      return profile.links ? profile.links.map((link) => link.label || link.url) : null;
    case "experience":
      return profile.experience ? profile.experience.map((item) => `${item.title} · ${item.organisation}`) : null;
    case "skills":
    case "sectors":
    case "interests":
    case "languages":
      return profile[key] ? profile[key].map((item) => item.name) : null;
    default:
      return profile[key] ?? null;
  }
}

type Result = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ok"; profile: MemberProfile; as: PreviewAs };

/** "Preview as" (CM-PRF-05): GET /me/profile/preview?as= shows exactly what the API serialises for that viewer. */
export function ProfilePreview({
  refreshKey,
  unsaved,
  filled,
}: {
  refreshKey: number;
  unsaved: boolean;
  /** Fields the owner has filled in; absent empty fields aren't reported as hidden. */
  filled: ProfileField[];
}) {
  const [as, setAs] = useState<PreviewAs>("member");
  const [result, setResult] = useState<Result>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    api<MemberProfile>("/me/profile/preview", { query: { as }, signal: controller.signal })
      .then((profile) => setResult({ kind: "ok", profile, as }))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setResult({ kind: "error", message: isApiError(error) ? error.message : "The preview didn’t load." });
      });
    return () => controller.abort();
  }, [as, refreshKey, attempt]);

  const audience = audiences.find((item) => item.value === as)!;
  const profile = result.kind === "ok" ? result.profile : null;
  const visible = profile ? shownFields.filter((field) => valueOf(profile, field.key) !== null) : [];
  const hidden = profile ? shownFields.filter((field) => valueOf(profile, field.key) === null && filled.includes(field.key)) : [];

  return (
    <Panel id="preview" aria-labelledby="preview-heading" className="flex scroll-mt-24 flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 id="preview-heading" className="text-h3 text-ink">
            Preview your profile
          </h2>
          <p className="text-xs text-secondary">
            {audience.description}. {unsaved ? "Save your changes to update the preview." : ""}
          </p>
        </div>
        <SegmentedControl
          label="Preview as"
          size="small"
          items={audiences}
          value={as}
          onChange={(value) => {
            setResult({ kind: "loading" });
            setAs(value);
          }}
        />
      </div>

      <div
        aria-live="polite"
        aria-busy={result.kind === "loading"}
        className="min-h-[180px] rounded-lg border border-line bg-surface p-4"
      >
        {result.kind === "loading" && (
          <div aria-hidden="true" className="flex items-center gap-3">
            <span className="size-14 animate-pulse rounded-full bg-muted" />
            <div className="flex flex-1 flex-col gap-2">
              <span className="h-4 w-1/3 animate-pulse rounded bg-muted" />
              <span className="h-3 w-1/2 animate-pulse rounded bg-muted" />
            </div>
          </div>
        )}
        {result.kind === "error" && (
          <div role="alert" className="flex flex-col items-start gap-2 text-sm">
            <p className="text-error">{result.message}</p>
            <button
              type="button"
              onClick={() => {
                setResult({ kind: "loading" });
                setAttempt((n) => n + 1);
              }}
              className="font-medium text-primary-light underline"
            >
              Try again
            </button>
          </div>
        )}
        {profile && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <Avatar name={profile.name} src={profile.avatarUrl ?? undefined} tone={profile.tone} size={56} />
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-md font-medium text-ink">{profile.name}</span>
                {profile.headline && <span className="text-sm text-secondary">{profile.headline}</span>}
              </div>
            </div>
            {visible.length > 0 ? (
              <dl className="grid grid-cols-[140px_1fr] gap-x-4 gap-y-2 text-sm max-sm:grid-cols-1">
                {visible.map((field) => {
                  const value = valueOf(profile, field.key);
                  return (
                    <div key={field.key} className="contents">
                      <dt className="text-secondary">{field.label}</dt>
                      <dd className="min-w-0 break-words text-ink max-sm:mb-1">
                        {Array.isArray(value) ? (
                          value.length ? (
                            value.join(", ")
                          ) : (
                            <span className="text-disabled">None added</span>
                          )
                        ) : (
                          value
                        )}
                      </dd>
                    </div>
                  );
                })}
              </dl>
            ) : (
              <p className="text-sm text-secondary">Only your name, photo and headline are visible.</p>
            )}
            {hidden.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 border-t border-line pt-3">
                <span className="flex items-center gap-1 text-xs text-secondary">
                  <Icon name="eye-off" size={14} />
                  Hidden from this viewer:
                </span>
                {hidden.map((field) => (
                  <Chip key={field.key} tone="neutral" className="px-2 py-0.5 text-xs">
                    {field.label}
                  </Chip>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </Panel>
  );
}
