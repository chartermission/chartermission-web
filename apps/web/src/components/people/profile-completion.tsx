import Link from "next/link";
import { cache } from "react";
import {
  PROFILE_COMPLETENESS_LABELS,
  PROFILE_COMPLETENESS_WEIGHTS,
  type OwnProfile,
  type ProfileCompletenessField,
} from "@chartermission/contracts";
import { Icon, Panel } from "@chartermission/ui";
import { apiGet } from "@/lib/api/server";
import { getT } from "@/i18n/server";

/** GET /me/profile, once per request however many cards ask. Null if it fails: the card is a nicety. */
const getOwnProfile = cache(() => apiGet<OwnProfile>("/me/profile").catch(() => null));

/** Where each part of the profile is filled in (anchors in the profile editor and the intro video card). */
const fixHref: Record<ProfileCompletenessField, string> = {
  avatar: "/settings/profile#photo",
  cover: "/settings/profile#cover",
  headline: "/settings/profile#basics",
  organisation: "/settings/profile#basics",
  country: "/settings/profile#basics",
  city: "/settings/profile#basics",
  bio: "/settings/profile#about",
  experience: "/settings/profile#experience",
  introVideo: "/settings/profile#intro",
  skills: "/settings/profile#skills",
  sectors: "/settings/profile#sectors",
  interests: "/settings/profile#interests",
  languages: "/settings/profile#languages",
};

const isField = (key: string): key is ProfileCompletenessField => key in PROFILE_COMPLETENESS_WEIGHTS;

/** The heaviest missing parts listed on the card; the rest are a link away. */
const MAX_LISTED = 5;

/**
 * "Profile completion" for the owner's own profile page: the percentage, a bar and what's
 * missing (heaviest first), each linking to where it's filled in. `rail` sits at the top of
 * the right rail and keeps a short "complete" state; `main` is the narrow-screen copy at the
 * top of the main column and disappears at 100%.
 */
export async function ProfileCompletionCard({ variant }: { variant: "rail" | "main" }) {
  const [profile, t] = await Promise.all([getOwnProfile(), getT()]);
  if (!profile) return null;
  const { percent, missing, items } = profile.completeness;
  const headingId = `profile-completion-${variant}`;

  if (missing.length === 0 || percent >= 100) {
    if (variant === "main") return null;
    return (
      <Panel aria-labelledby={headingId} className="flex items-center gap-3 p-4">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-success-light text-success">
          <Icon name="check" size={16} />
        </span>
        <span className="flex min-w-0 flex-col gap-0.5">
          <h2 id={headingId} className="text-sm font-medium text-ink">
            Your profile is complete
          </h2>
          <span className="text-xs text-secondary">Members can see who you are and what you work on.</span>
        </span>
      </Panel>
    );
  }

  const weightOf = (key: string) => items.find((item) => item.key === key)?.weight ?? (isField(key) ? PROFILE_COMPLETENESS_WEIGHTS[key] : 0);
  const listed = missing.slice(0, MAX_LISTED);
  const more = missing.length - listed.length;

  return (
    <Panel aria-labelledby={headingId} className="flex flex-col gap-3 p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 id={headingId} className="text-h3 text-ink">
          Profile completion
        </h2>
        <span className="text-h3 text-primary">{percent}%</span>
      </div>
      <div
        role="progressbar"
        aria-labelledby={headingId}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="h-2 overflow-hidden rounded-full bg-muted"
      >
        <span className="block h-full rounded-full bg-accent" style={{ width: `${percent}%` }} />
      </div>
      <p className="text-sm text-secondary">Add these so members can find you.</p>
      <ul className="-mx-2 flex flex-col">
        {listed.map((key) => (
          <li key={key}>
            <Link
              href={isField(key) ? fixHref[key] : "/settings/profile"}
              className="group flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-muted"
            >
              <Icon name="plus" size={14} className="shrink-0 text-secondary" />
              <span className="min-w-0 flex-1 truncate font-medium text-ink group-hover:underline">
                {t(isField(key) ? PROFILE_COMPLETENESS_LABELS[key] : key)}
              </span>
              <span className="shrink-0 text-xs font-medium text-success">{t("+{weight}%", { weight: weightOf(key) })}</span>
            </Link>
          </li>
        ))}
      </ul>
      {more > 0 && (
        <Link href="/settings/profile" className="self-start text-sm font-medium text-primary-light hover:underline">
          {t("{count} more to add", { count: more })}
        </Link>
      )}
    </Panel>
  );
}
